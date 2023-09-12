// @ts-nocheck

import { useEffect, useState, useRef } from 'react'
import './App.css'

async function createPeerConnection() {
  console.log('create peer connection')
  let iceServers = []
  /*[
    {
      urls: 'stun:stun.l.google.com:19302',
    },
  ]*/
  const peerConnection = new RTCPeerConnection({
    sdpSemantics: 'unified-plan',
    iceServers: iceServers,
  })
  const dataChannel = peerConnection.createDataChannel('datachannel')
  const offer = await peerConnection.createOffer({
    offerToReceiveVideo: true,
  })
  await peerConnection.setLocalDescription(offer)
  console.log('ice gathering')
  if (peerConnection.iceGatheringState !== 'complete') {
    await new Promise((resolve) => {
      function checkState() {
        if (peerConnection.iceGatheringState === 'complete') {
          peerConnection.removeEventListener(
            'icegatheringstatechange',
            checkState
          )
          resolve()
        }
      }
      peerConnection.addEventListener('icegatheringstatechange', checkState)
    })
  }
  console.log('ice gathering complete')
  return { peerConnection: peerConnection, dataChannel: dataChannel }
}

function connectSignaler(openCallback, messageCallback, closeCallback) {
  const socket = new WebSocket('ws://localhost:8080/connect')
  console.log(`connected to socket`)
  socket.addEventListener('open', () => {
    openCallback(socket)
  })
  socket.addEventListener('message', (event) => {
    messageCallback(socket, JSON.parse(event.data))
  })
  socket.addEventListener('close', () => {
    closeCallback(socket)
  })
  return socket
}

function App() {
  const [peerIds, setPeerIds] = useState([])
  const dataChannel = useRef(null)
  const signaler = useRef(null)
  const peerConnection = useRef(null)
  const refVideo = useRef<HTMLVideoElement>(null)
  const initialized = useRef(false)

  async function sendOffer(peerId) {
    console.log(`send offer to ${peerId}`)
    const response = await createPeerConnection()
    response.dataChannel.addEventListener('message', (e) =>
      console.log(`datachannel received message ${e.data}`)
    )
    response.peerConnection.addEventListener('track', ({ track }) => {
      console.log(`received media track`)
      refVideo.current.srcObject = new MediaStream([track])
    })
    peerConnection.current = response.peerConnection
    dataChannel.current = response.dataChannel
    const offer = peerConnection.current.localDescription
    const message = JSON.stringify({
      to: peerId,
      message: {
        sdp: offer.sdp,
        type: offer.type,
      },
    })
    console.log(`send messsage to signaler ${message}`)
    signaler.current.send(message)
  }

  async function handleMessage(socket, message) {
    switch (message.type) {
      case 'peers':
        console.log(`received peers from signaler ${JSON.stringify(message)}`)
        setPeerIds(message.peerIds)
        if (message.peerIds.length > 0) {
          sendOffer(message.peerIds[0])
        }
        break
      case 'rtc':
        console.log(`received rtc message from signaler ${JSON.stringify(message)}`)
        await peerConnection.current.setRemoteDescription(message.message)
        break
    }
  }

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    signaler.current = connectSignaler(
      () => console.log('opened connection to signaler'),
      handleMessage,
      console.log('closed connection so signaler')
    )

    console.log("set interval for gamepad polling")
    setInterval(() => {
      const gamepads = navigator.getGamepads()
      if (gamepads.length && gamepads[0]) {
        const throttle =
          500 +
          Math.floor(
            (gamepads[0].buttons[6].value !== 0
              ? -gamepads[0].buttons[6].value
              : gamepads[0].buttons[7].value) * 500
          )
        const steering = 500 + Math.floor(gamepads[0].axes[0] * 500)
        const message = JSON.stringify({
          type: 'control',
          throttle: throttle,
          steering: steering,
        })
        console.log(message)
        dataChannel.current.send(message)
      }
    }, 1000 / 30)
  }, [])

  return (
    <>
      <video ref={refVideo} autoPlay muted draggable="false" />
    </>
  )
}

export default App
