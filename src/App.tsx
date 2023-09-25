// @ts-nocheck

import { useEffect, useState, useRef } from 'react'
import Form from 'react-bootstrap/Form'
import Button from 'react-bootstrap/Button'
import Feature from 'ol/Feature.js'
import Map from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Point from 'ol/geom/Point.js'
import OSM from 'ol/source/OSM.js'
import { fromLonLat } from 'ol/proj.js'
import { Circle, Fill, Style } from 'ol/style.js'

function GeoMap(props) {
  const map = useRef()
  const robotGeometry = useRef()
  const element = useRef()

  useEffect(() => {
    if (!map.current) {
      console.log('initialize geomap')
      robotGeometry.current = new Point(
        fromLonLat([props.longitude, props.latitude])
      )
      map.current = new Map({
        target: element.current,
        layers: [
          new TileLayer({
            source: new OSM(),
          }),
          new VectorLayer({
            source: new VectorSource({
              features: [new Feature(robotGeometry.current)],
            }),
            style: new Style({
              image: new Circle({
                radius: 5,
                fill: new Fill({
                  color: 'blue',
                }),
              }),
            }),
          }),
        ],
        view: new View({
          center: fromLonLat([props.longitude, props.latitude]),
          zoom: props.zoom,
        }),
        controls: [],
      })
    }
  }, [])

  useEffect(() => {
    const coordinates = fromLonLat([props.longitude, props.latitude])
    robotGeometry.current.setCoordinates(coordinates)
    map.current.getView().setCenter(coordinates)
  }, [props.longitude, props.latitude])

  useEffect(() => {
    map.current.getView().setZoom(props.zoom)
  }, [props.zoom])

  return (
    <>
      <div style={props.style} ref={element} className="map-container"></div>
    </>
  )
}

const ID = 'id' + Math.random().toString(16).slice(2)

async function createPeerConnection() {
  console.log('create peer connection')
  const iceServers = [
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
  return { peerConnection: peerConnection, dataChannel: dataChannel }
}

function connectSignaler(messageCallback, reconnectCallback) {
  console.log(`connect to socket`)
  const socket = new WebSocket(
    `${import.meta.env.VITE_SIGNALING_URL}/connect?id=${ID}`
  )
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
  const maxThrottleFactor = 500
  const throttleFactorDelta = 0.002 * maxThrottleFactor
  const minSteering = 0
  const maxSteering = 1000
  const steeringStraight = useRef(500)
  const steeringStraightDelta = 0.1
  const maxSteeringFactor = useRef(
    Math.min(
      steeringStraight.current - minSteering,
      maxSteering - steeringStraight.current
    )
  )
  const steeringFactorDelta = 0.002 * maxSteeringFactor.current
  const steeringFactor = useRef(150)
  const throttleFactor = useRef(100)
  const lightSent = useRef(false)
  const [robotId, setRobotId] = useState('')
  const [robotIdSet, setRobotIdSet] = useState(false)
  const dataChannel = useRef(null)
  const signaler = useRef(null)
  const peerConnection = useRef(null)
  const refVideo = useRef<HTMLVideoElement>(null)
  const initialized = useRef(false)
  const [controlFactors, setControlFactors] = useState({
    throttle: throttleFactor.current,
    steering: steeringFactor.current,
    steeringStraight: steeringStraight.current,
  })
  const [batteryVoltage, setBatteryVoltage] = useState(null)
  const [phoneState, setPhoneState] = useState(null)

  async function sendOffer(peerId) {
    console.log(`send offer to ${peerId}`)
    const response = await createPeerConnection()
    response.dataChannel.addEventListener('message', (e) => {
      console.log(`datachannel received message ${e.data}`)
      const message = JSON.parse(e.data)
      switch (message.type) {
        case 'battery': {
          const batteryVoltage = {
            a: message.voltageA / 100,
            b: message.voltageB / 100,
          }
          console.log(`set battery voltage ${JSON.stringify(batteryVoltage)}`)
          setBatteryVoltage(batteryVoltage)
          break
        }
        case 'phoneState': {
          const phoneState = {
            battery: message.battery,
            signal: message.signal,
            bandwidthUp: message.bandwidthUp,
            bandwidthDown: message.bandwidthDown,
            location: message.location,
          }
          console.log(`set phoneState ${JSON.stringify(phoneState)}`)
          setPhoneState(phoneState)
          break
        }
      }
    })
    response.peerConnection.addEventListener('track', ({ track }) => {
      console.log(`received media track`)
      refVideo.current.srcObject = new MediaStream([track])
    })
    response.peerConnection.addEventListener(
      'icecandidate',
      ({ candidate }) => {
        if (candidate !== null) {
          const message = JSON.stringify({
            to: peerId,
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
        console.log('set peer connection to null')
        peerConnection.current = null
        if (signaler.current.readyState === 1 && peerId !== null) {
          sendOffer()
        }
      }
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

  async function handleMessage(message) {
    console.log(message)
    switch (message.type) {
      // case 'peers':
      //   console.log(`received peers from signaler ${JSON.stringify(message)}`)
      //   if (message.peerIds.length > 0) {
      //     peerId.current = message.peerIds[0]
      //     console.log(peerConnection.current)
      //     if (!peerConnection.current) {
      //       console.log('send offer')
      //       sendOffer()
      //     }
      //   } else {
      //     peerId.current = null
      //   }
      //   break
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
        } else if (message.message == 'failure') {
          console.log('resend offer because peer failure')
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
        let factorsUpdated = false
        if (gamepads[0].buttons[3].pressed) {
          throttleFactor.current = Math.min(
            throttleFactor.current + throttleFactorDelta,
            maxThrottleFactor
          )
          factorsUpdated = true
        }
        if (gamepads[0].buttons[0].pressed) {
          throttleFactor.current = Math.max(
            throttleFactor.current - throttleFactorDelta,
            0
          )
          factorsUpdated = true
        }
        if (gamepads[0].buttons[1].pressed) {
          steeringFactor.current = Math.min(
            steeringFactor.current + steeringFactorDelta,
            maxSteeringFactor.current
          )
          factorsUpdated = true
        }
        if (gamepads[0].buttons[2].pressed) {
          steeringFactor.current = Math.max(
            steeringFactor.current - steeringFactorDelta,
            0
          )
          factorsUpdated = true
        }
        if (gamepads[0].buttons[14].pressed) {
          steeringStraight.current -= steeringStraightDelta
          maxSteeringFactor.current = Math.min(
            steeringStraight.current - minSteering,
            maxSteering - steeringStraight.current
          )
          steeringFactor.current = Math.min(
            steeringFactor.current,
            maxSteeringFactor.current
          )
          factorsUpdated = true
        }
        if (gamepads[0].buttons[15].pressed) {
          steeringStraight.current += steeringStraightDelta
          maxSteeringFactor.current = Math.min(
            steeringStraight.current - minSteering,
            maxSteering - steeringStraight.current
          )
          steeringFactor.current = Math.min(
            steeringFactor.current,
            maxSteeringFactor.current
          )
          factorsUpdated = true
        }
        if (factorsUpdated) {
          setControlFactors({
            throttle: Math.floor(throttleFactor.current),
            steering: Math.floor(steeringFactor.current),
            steeringStraight: Math.floor(steeringStraight.current),
          })
        }
        const throttle = Math.floor(
          500 +
            (gamepads[0].buttons[6].value !== 0
              ? -gamepads[0].buttons[6].value * maxThrottleFactor
              : gamepads[0].buttons[7].value * throttleFactor.current)
        )

        const steering = Math.floor(
          steeringStraight.current +
            gamepads[0].axes[0] * steeringFactor.current
        )
        const message = JSON.stringify({
          type: 'control',
          throttle: throttle,
          steering: steering,
        })
        //console.log(message)
        dataChannel.current.send(message)

        if (gamepads[0].buttons[5].pressed) {
          if (!lightSent.current) {
            dataChannel.current.send(
              JSON.stringify({
                type: 'light',
              })
            )
            lightSent.current = true
          }
        } else if (lightSent.current) {
          lightSent.current = false
        }
      }
    }, 1000 / 100)
  }, [])

  return (
    <>
      {!robotIdSet ? (
        <>
          <Form.Control
            size="lg"
            type="text"
            placeholder="robot"
            value={robotId}
            onChange={(e) => setRobotId(e.target.value)}
          />
          <Button variant="primary" onClick={() => {
            console.log(robotId)
            setRobotIdSet(true)
            sendOffer(robotId)}}>
            Connect
          </Button>
        </>
      ) : (
        <>
          <video
            ref={refVideo}
            autoPlay
            muted
            draggable="false"
            width="960"
            height="720"
          />
          <p>
            steering straight: {controlFactors.steeringStraight} throttle
            factor: {controlFactors.throttle} steering factor:{' '}
            {controlFactors.steering}
          </p>
          {batteryVoltage && (
            <p>
              battery voltage cell a: {batteryVoltage.a}V b: {batteryVoltage.b}V
            </p>
          )}
          {phoneState && (
            <>
              <p>
                phone battery level: {phoneState.battery}% network signal
                strength: {phoneState.signal} bandwidth up:{' '}
                {phoneState.bandwidthUp}kbps bandwidth down:{' '}
                {phoneState.bandwidthDown}kbps
              </p>
              <p>
                longitude: {phoneState.location.longitude} latitude:{' '}
                {phoneState.location.latitude} speed:{' '}
                {phoneState.location.speed * 3.6}km/h
              </p>

              <GeoMap
                longitude={phoneState?.location.longitude}
                latitude={phoneState?.location?.latitude}
                zoom={15}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 300,
                  height: 300,
                }}
              />
            </>
          )}
        </>
      )}
    </>
  )
}

export default App
