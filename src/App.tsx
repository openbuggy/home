// @ts-nocheck

import { useEffect, useState, useRef } from 'react'
import './App.css'

async function createPeerConnection() {
  let iceServers = [
    {
      urls: 'stun:stun.l.google.com:19302',
    },
  ]
  const peerConnection = new RTCPeerConnection({
    sdpSemantics: 'unified-plan',
    iceServers: iceServers,
  })
  const dataChannel = peerConnection.createDataChannel('datachannel')
  const offer = await peerConnection.createOffer({
    offerToReceiveVideo: true,
  })
  await peerConnection.setLocalDescription(offer)
  if (peerConnection.iceGatheringState !== 'complete') {
    await new Promise((resolve) => {
      function checkState() {
        if (peerConnection.iceGatheringState === 'complete') {
          peerConnection.removeEventListener('icegatheringstatechange', checkState)
          resolve()
        }
      }
      peerConnection.addEventListener('icegatheringstatechange', checkState)
    })
  }
  return { peerConnection: peerConnection, dataChannel: dataChannel }
}

function connectSignaler(openCallback, messageCallback, closeCallback) {
  const socket = new WebSocket('ws://localhost:8080/connect')
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
  const [dataChannel, setDataChannel] = useState(null)
  const signaler = useRef(null)
  const peerConnection = useRef(null)
  const refVideo = useRef<HTMLVideoElement>(null)
  const initialized = useRef(false)

  async function sendOffer(peerId) {
    const response = await createPeerConnection()
    response.dataChannel.addEventListener('message', (e) => console.log(e.data))
    response.peerConnection.addEventListener('track', ({ track }) => {
      refVideo.current.srcObject = new MediaStream([track])
    })
    peerConnection.current = response.peerConnection
    setDataChannel(response.dataChannel)
    const offer = peerConnection.current.localDescription
    signaler.current.send(
      JSON.stringify({
        to: peerId,
        message: {
          sdp: offer.sdp,
          type: offer.type,
        },
      })
    )
  }

  function handleMessage(socket, message) {
    switch (message.type) {
      case 'peers':
        setPeerIds(message.peerIds)
        if (message.peerIds.length > 0) {
          sendOffer(message.peerIds[0])
        }
        break
      case 'rtc':
        peerConnection.current.setRemoteDescription(message.message)
        break
    }
  }

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    signaler.current = connectSignaler(
      () => console.log('open'),
      handleMessage,
      console.log('closed')
    )
  }, [])

  return (
    <>
      <video ref={refVideo} autoPlay muted draggable="false" />
    </>
  )
}

export default App
