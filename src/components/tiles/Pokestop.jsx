// @ts-check
import * as React from 'react'
import { Marker, Popup, Circle } from 'react-leaflet'

import useMarkerTimer from '@hooks/useMarkerTimer'
import { basicEqualFn, useStatic, useStore } from '@hooks/useStore'

import PopupContent from '../popups/Pokestop'
import ToolTipWrapper from './Timer'
import usePokestopMarker from '../markers/usePokestopMarker'

/**
 *
 * @param {import('@rm/types').Pokestop & { force: boolean }} props
 * @returns
 */
const PokestopTile = ({ force, ...pokestop }) => {
  const markerRef = React.useRef(null)
  const [done, setDone] = React.useState(false)
  const [stateChange, setStateChange] = React.useState(false)

  const [
    hasLure,
    hasInvasion,
    hasQuest,
    hasEvent,
    hasAllStops,
    showTimer,
    interactionRangeZoom,
  ] = useStatic((s) => {
    const newTs = Date.now() / 1000
    const { filters } = useStore.getState()
    const {
      config,
      excludeList,
      timerList,
      auth: { perms },
    } = s
    return [
      pokestop.lure_expire_timestamp > newTs &&
        perms.lures &&
        !excludeList.includes(`l${pokestop.lure_id}`),
      !!(
        perms.invasions &&
        pokestop.invasions?.some(
          (invasion) =>
            invasion.grunt_type &&
            !excludeList.includes(`i${invasion.grunt_type}`) &&
            invasion.incident_expire_timestamp > newTs,
        )
      ),
      !!(
        perms.quests &&
        pokestop.quests?.some((quest) => !excludeList.includes(quest.key))
      ),
      !!(
        perms.eventStops &&
        filters.pokestops.eventStops &&
        pokestop.events?.some((event) => event.event_expire_timestamp > newTs)
      ),
      (filters.pokestops.allPokestops || pokestop.ar_scan_eligible) &&
        perms.pokestops,
      timerList.includes(pokestop.id),
      config.map.interactionRangeZoom,
    ]
  }, basicEqualFn)

  const [
    invasionTimers,
    lureTimers,
    eventStopTimers,
    lureRange,
    interactionRange,
    customRange,
  ] = useStore((s) => {
    const { userSettings, zoom } = s
    return [
      userSettings.pokestops.invasionTimers || showTimer,
      userSettings.pokestops.lureTimers || showTimer,
      userSettings.pokestops.eventStopTimers || showTimer,
      !!userSettings.pokestops.lureRange && zoom >= interactionRangeZoom,
      !!userSettings.pokestops.interactionRange && zoom >= interactionRangeZoom,
      zoom >= interactionRangeZoom ? userSettings.pokestops.customRange : 0,
    ]
  }, basicEqualFn)

  const timers = React.useMemo(() => {
    const internalTimers = /** @type {number[]} */ ([])
    if (invasionTimers && hasInvasion) {
      pokestop.invasions.forEach((invasion) =>
        internalTimers.push(invasion.incident_expire_timestamp),
      )
    }
    if (lureTimers && hasLure) {
      internalTimers.push(pokestop.lure_expire_timestamp)
    }
    if (eventStopTimers && hasEvent) {
      pokestop.events.forEach((event) => {
        internalTimers.push(event.event_expire_timestamp)
      })
    }
    return internalTimers
  }, [
    invasionTimers,
    hasInvasion,
    lureTimers,
    hasLure,
    eventStopTimers,
    hasEvent,
  ])

  useMarkerTimer(timers.length ? Math.min(...timers) : null, markerRef, () =>
    setStateChange(!stateChange),
  )

  const icon = usePokestopMarker({
    hasQuest,
    hasLure,
    hasInvasion,
    hasEvent,
    ...pokestop,
  })

  React.useEffect(() => {
    if (force && !done && markerRef.current) {
      markerRef.current.openPopup()
      setDone(true)
    }
  }, [force])

  return (
    !!(hasQuest || hasLure || hasInvasion || hasEvent || hasAllStops) && (
      <Marker
        ref={markerRef}
        position={[pokestop.lat, pokestop.lon]}
        icon={icon}
      >
        <Popup position={[pokestop.lat, pokestop.lon]}>
          <PopupContent
            hasLure={hasLure}
            hasInvasion={hasInvasion}
            hasQuest={hasQuest}
            hasEvent={hasEvent}
            hasAllStops={hasAllStops}
            {...pokestop}
          />
        </Popup>
        {Boolean(timers.length) && (
          <ToolTipWrapper timers={timers} offset={[0, 4]} />
        )}
        {interactionRange && (
          <Circle
            center={[pokestop.lat, pokestop.lon]}
            radius={80}
            pathOptions={{ color: '#0DA8E7', weight: 1 }}
          />
        )}
        {lureRange && (
          <Circle
            center={[pokestop.lat, pokestop.lon]}
            radius={40}
            pathOptions={{ color: '#32cd32', weight: 1 }}
          />
        )}
        {!!customRange && (
          <Circle
            center={[pokestop.lat, pokestop.lon]}
            radius={customRange}
            pathOptions={{ color: 'purple', weight: 0.5 }}
          />
        )}
      </Marker>
    )
  )
}

const MemoPokestopTile = React.memo(
  PokestopTile,
  (prev, next) =>
    prev.id === next.id &&
    prev.lure_expire_timestamp === next.lure_expire_timestamp &&
    prev.updated === next.updated &&
    prev.quests?.length === next.quests?.length &&
    (prev.quests && next.quests
      ? prev.quests.every((q, i) => q.with_ar === next.quests[i]?.with_ar)
      : true) &&
    prev.invasions?.length === next.invasions?.length &&
    (prev.invasions && next.invasions
      ? prev.invasions?.every(
          (inv, i) =>
            inv.confirmed === next?.invasions?.[i]?.confirmed &&
            inv.grunt_type === next?.invasions?.[i]?.grunt_type,
        )
      : true) &&
    prev.events?.length === next.events?.length,
)

export default MemoPokestopTile
