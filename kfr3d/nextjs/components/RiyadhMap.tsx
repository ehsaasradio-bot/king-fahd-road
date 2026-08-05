'use client';

/**
 * Back-compat wrapper. New code should use <CityMap city="riyadh" …>,
 * which works for every city.
 */
import CityMap, { type CityMapProps, type KfrMapElement } from './CityMap';

export { loadCityMap, CITIES } from './CityMap';
export type { KfrMapElement };

export type RiyadhMapProps = Omit<CityMapProps, 'city'>;

export default function RiyadhMap(props: RiyadhMapProps) {
  return <CityMap city="riyadh" {...props} />;
}
