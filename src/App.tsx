// @ts-nocheck

import { useEffect, useRef } from 'react'
import './App.css'

const ID = 'id' + Math.random().toString(16).slice(2)

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
  return { peerConnection: peerConnection, dataChannel: dataChannel }
}

function connectSignaler(messageCallback, reconnectCallback) {
  console.log(`connect to socket`)
  const socket = new WebSocket(`ws://localhost:8080/connect?id=${ID}`)
  socket.addEventListener('open', () => {
    console.log('open websocket')
  })
  socket.addEventListener('message', (event) => {
    messageCallback(JSON.parse(event.data))
  })
  socket.addEventListener('error', (e) => {
    console.log('error websocket', e)
  })
  socket.addEventListener('close', () => {
    console.log('close websocket')
    setTimeout(reconnectCallback, 1000)
  })
  return socket
}

function App() {
  const peerId = useRef(null)
  const dataChannel = useRef(null)
  const signaler = useRef(null)
  const peerConnection = useRef(null)
  const refVideo = useRef<HTMLVideoElement>(null)
  const initialized = useRef(false)

  async function sendOffer() {
    console.log(`send offer to ${peerId.current}`)
    const response = await createPeerConnection()
    response.dataChannel.addEventListener('message', (e) =>
      console.log(`datachannel received message ${e.data}`)
    )
    response.peerConnection.addEventListener('track', ({ track }) => {
      console.log(`received media track`)
      refVideo.current.srcObject = new MediaStream([track])
    })
    response.peerConnection.addEventListener(
      'icecandidate',
      ({ candidate }) => {
        if (candidate !== null) {
          const message = JSON.stringify({
            to: peerId.current,
            message: candidate,
          })
          console.log(`send candidate ${message}`)
          signaler.current.send(message)
        }
      }
    )
    response.peerConnection.addEventListener('iceconnectionstatechange', () => {
      console.log(
        `iceconnectionstate changed to ${response.peerConnection.iceConnectionState}`
      )
      // if (["failed", "closed"].includes(response.peerConnection.iceConnectionState)) {
      //   if (response.peerConnection.iceConnectionState !== "closed") {
      //     console.log("close old peerConnection")
      //     response.peerConnection.close()
      //   }
      //   if (peerId.current === peerId) {
      //     console.log(`resend offer to ${peerId.current}`)
      //     sendOffer(peerId.current)
      //   }
      // }
      if (response.peerConnection.iceConnectionState === 'failed') {
        console.log("set peer connection to null")
        peerConnection.current = null
        if (signaler.current.readyState === 1 && peerId.current !== null) {
          sendOffer()
        }
      }
    })
    peerConnection.current = response.peerConnection
    dataChannel.current = response.dataChannel
    const offer = peerConnection.current.localDescription
    const message = JSON.stringify({
      to: peerId.current,
      message: {
        sdp: offer.sdp,
        type: offer.type,
      },
    })
    console.log(`send messsage to signaler ${message}`)
    signaler.current.send(message)
  }

  async function handleMessage(message) {
    console.log(message)
    switch (message.type) {
      case 'peers':
        console.log(`received peers from signaler ${JSON.stringify(message)}`)
        if (message.peerIds.length > 0) {
          peerId.current = message.peerIds[0]
          console.log(peerConnection.current)
          if (!peerConnection.current) {
            console.log("send offer")
            sendOffer()
          }
        } else {
          peerId.current = null
        }
        break
      case 'rtc':
        console.log(
          `received rtc message from signaler ${JSON.stringify(message)}`
        )
        if (message.message.candidate) {
          console.log('add ice candidate')
          await peerConnection.current.addIceCandidate(message.message)
        } else if (message.message.sdp) {
          console.log('set answer')
          await peerConnection.current.setRemoteDescription(message.message)
        } else if (message.message == "failure") {
          console.log("resend offer because peer failure")
          sendOffer()
        }
    }
  }

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    function setSignaler() {
      signaler.current = connectSignaler(handleMessage, setSignaler)
    }
    setSignaler()
    console.log('set interval for gamepad polling')
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
      <video ref={refVideo} autoPlay muted draggable="false" width="960" height="720"/>
    </>
  )
}

export default App
