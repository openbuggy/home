// @ts-nocheck

import { useEffect, useState, useRef } from 'react'
import Form from 'react-bootstrap/Form'
import Button from 'react-bootstrap/Button'
import Map from 'ol/Map'
import View from 'ol/View'
import Feature from 'ol/Feature.js'
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

  return <div style={props.style} ref={element} className="map-container" />
}

function App() {
  const userId = 'user'
  const maxThrottleSend = 500
  const maxSteeringSend = 500
  const maxThrottleDelta = 0.002
  const maxSteeringDelta = 0.002
  const steeringStraightDelta = 0.0002

  const [robotId, setRobotId] = useState('buggy')
  const [robotIdSet, setRobotIdSet] = useState(false)
  const [maxThrottle, setMaxThrottle] = useState(0.2)
  const [maxSteering, setMaxSteering] = useState(0.2)
  const [steeringStraight, setSteeringStraight] = useState(0.03)
  const [focusDistance, setFocusDistance] = useState(0)
  const [batteryVoltage, setBatteryVoltage] = useState(null)
  const [location, setLocation] = useState(null)
  const [phoneState, setPhoneState] = useState(null)

  const controlRef = useRef({
    maxThrottle: maxThrottle,
    maxSteering: maxSteering,
    steeringStraight: steeringStraight,
  })
  const maxMaxSteering = useRef(1 - Math.abs(steeringStraight))
  const lightSent = useRef(false)
  const signaler = useRef(null)
  const peerConnection = useRef(null)
  const dataChannel = useRef(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const initialized = useRef(false)

  async function sendOffer(peerId) {
    console.log(`send offer to ${peerId}`)
    console.log('create peer connection')
    peerConnection.current = new RTCPeerConnection({
      sdpSemantics: 'unified-plan',
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302',
        },
      ],
    })
    dataChannel.current =
      peerConnection.current.createDataChannel('datachannel')
    await peerConnection.current.setLocalDescription(
      await peerConnection.current.createOffer({
        offerToReceiveVideo: true,
      })
    )
    dataChannel.current.addEventListener('message', (e) => {
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
        case 'location': {
          const location = {
            latitude: message.latitude,
            longitude: message.longitude,
            speed: message.speed,
          }
          console.log(`set location ${JSON.stringify(location)}`)
          setLocation(location)
          break
        }
        case 'phoneState': {
          const phoneState = {
            battery: message.battery,
            signal: message.signal,
            bandwidthUp: message.bandwidthUp,
            bandwidthDown: message.bandwidthDown,
          }
          console.log(`set phoneState ${JSON.stringify(phoneState)}`)
          setPhoneState(phoneState)
          break
        }
      }
    })
    peerConnection.current.addEventListener('track', ({ track }) => {
      console.log(`received media track`)
      videoRef.current.srcObject = new MediaStream([track])
    })
    peerConnection.current.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate !== null) {
        const message = JSON.stringify({
          to: peerId,
          message: candidate,
        })
        console.log(`send candidate ${message}`)
        signaler.current.send(message)
      }
    })
    peerConnection.current.addEventListener('iceconnectionstatechange', () => {
      console.log(
        `iceconnectionstate changed to ${peerConnection.current.iceConnectionState}`
      )
      if (peerConnection.current.iceConnectionState === 'failed') {
        console.log('set peer connection to null')
        peerConnection.current = null
        if (signaler.current.readyState === 1) {
          sendOffer()
        }
      }
    })
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

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    function setSignaler() {
      console.log(`connect to socket`)
      signaler.current = new WebSocket(
        `${import.meta.env.VITE_SIGNALING_URL}/connect?id=${userId}`
      )
      signaler.current.addEventListener('open', () => {
        console.log('open websocket')
      })
      signaler.current.addEventListener('message', (event) => {
        const message = JSON.parse(event.data)
        console.log(message)
        switch (message.type) {
          case 'rtc':
            console.log(
              `received rtc message from signaler ${JSON.stringify(message)}`
            )
            if (message.message.candidate) {
              console.log('add ice candidate')
              peerConnection.current.addIceCandidate(message.message)
            } else if (message.message.sdp) {
              console.log('set answer')
              peerConnection.current.setRemoteDescription(message.message)
            } else if (message.message == 'failure') {
              console.log('resend offer because peer failure')
              sendOffer()
            }
        }
      })
      signaler.current.addEventListener('error', (e) => {
        console.log('error websocket', e)
      })
      signaler.current.addEventListener('close', () => {
        console.log('close websocket')
        setTimeout(setSignaler(), 1000)
      })
    }
    setSignaler()

    console.log('set interval for gamepad polling')
    setInterval(() => {
      const gamepads = navigator.getGamepads()
      if (gamepads.length && gamepads[0]) {
        if (gamepads[0].buttons[5].pressed) {
          setMaxThrottle(
            Math.min(controlRef.current.maxThrottle + maxThrottleDelta, 1)
          )
        }
        if (gamepads[0].buttons[4].pressed) {
          setMaxThrottle(
            Math.max(controlRef.current.maxThrottle - maxThrottleDelta, 0)
          )
        }
        if (gamepads[0].buttons[3].pressed) {
          setMaxSteering(
            Math.min(
              controlRef.current.maxSteering + maxSteeringDelta,
              maxMaxSteering.current
            )
          )
        }
        if (gamepads[0].buttons[0].pressed) {
          setMaxSteering(
            Math.max(controlRef.current.maxSteering - maxSteeringDelta, 0)
          )
        }
        if (
          gamepads[0].buttons[14].pressed ||
          gamepads[0].buttons[15].pressed
        ) {
          const steeringStraight = Math.max(
            Math.min(
              controlRef.current.steeringStraight +
                (gamepads[0].buttons[14].pressed ? -1 : 1) *
                  steeringStraightDelta,
              1
            ),
            -1
          )
          setSteeringStraight(steeringStraight)
          maxMaxSteering.current = 1 - Math.abs(steeringStraight)
          setMaxSteering(
            Math.min(controlRef.current.maxSteering, maxMaxSteering.current)
          )
        }

        const throttle =
          maxThrottleSend +
          Math.floor(
            (gamepads[0].buttons[6].value !== 0
              ? -gamepads[0].buttons[6].value
              : gamepads[0].buttons[7].value * controlRef.current.maxThrottle) *
              maxThrottleSend
          )
        const steering = Math.floor(
          (1 + controlRef.current.steeringStraight) * maxSteeringSend +
            gamepads[0].axes[0] *
              controlRef.current.maxSteering *
              maxSteeringSend
        )
        const message = JSON.stringify({
          type: 'control',
          throttle: throttle,
          steering: steering,
        })
        //console.log(message)
        dataChannel.current.send(message)

        if (gamepads[0].buttons[9].pressed) {
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
    }, 1000 / 200)
  }, [])

  useEffect(() => {
    controlRef.current.maxThrottle = maxThrottle
  }, [maxThrottle])

  useEffect(() => {
    controlRef.current.maxSteering = maxSteering
  }, [maxSteering])

  useEffect(() => {
    controlRef.current.steeringStraight = steeringStraight
  }, [steeringStraight])

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100vh',
        width: '100vw',
        backgroundColor: 'rgb(20,20,20)',
      }}
    >
      {!robotIdSet ? (
        <div style={{position: "absolute", top:"50%", left:"50%",  transform: "translate(-50%, -50%)"}}>
          <Form.Control
            style={{marginBottom: "10px"}}
            size="lg"
            type="text"
            value={robotId}
            onChange={(e) => setRobotId(e.target.value)}
          />
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              setRobotIdSet(true)
              sendOffer(robotId)
            }}
          >
            Connect
          </Button>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            muted
            draggable="false"
            height="240"
            width="320"
            style={{ height: '100%', width: '100%' }}
          />
          {location && (
            <GeoMap
              longitude={location.longitude}
              latitude={location.latitude}
              zoom={15}
              style={{
                position: 'absolute',
                bottom: '15px',
                left: '15px',
                width: '250px',
                height: '250px',
                borderRadius: '24px',
                overflow: 'hidden',
              }}
            />
          )}
          <div
            style={{
              position: 'absolute',
              bottom: '15px',
              right: '15px',
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderRadius: '24px',
              padding: '20px',
              color: 'white',
            }}
          >
            {location && (
              <p style={{ fontSize: '40px' }}>
                {location.speed * 3.6} km/h
              </p>
            )}
            <div style={{ fontSize: '20px' }}>
              <p>throttle max: {Math.floor(maxThrottle * 100)} %</p>
              <p>steering max: {Math.floor(maxSteering * 100)} %</p>
              <p>steering straight: {(steeringStraight * 100).toFixed(1)} %</p>
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              top: '15px',
              right: '15px',
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderRadius: '24px',
              padding: '20px',
              color: 'white',
              fontSize: '16px',
            }}
          >
            {batteryVoltage && (
              <p>
                battery a: {batteryVoltage.a} V b: {batteryVoltage.b} V
              </p>
            )}
            {phoneState && (
              <>
                <p>phone battery level: {phoneState.battery} %</p>
                <p>network signal strength: {phoneState.signal}</p>
                <p>
                  bandwidth up: {Math.floor(phoneState.bandwidthUp / 1000)} mbps
                </p>
                <p>
                  bandwidth down: {Math.floor(phoneState.bandwidthDown / 1000)}{' '}
                  mbps
                </p>
              </>
            )}
            <p>camera focus: {focusDistance}</p>
          </div>
        </>
      )}
    </div>
  )
}

export default App
