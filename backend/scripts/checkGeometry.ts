import { bearing, toCardinal, nearSouth, metresBetween } from '../src/services/orientation.js';

// A house at a known point, with the street pano placed in each direction.
const house = { lat: 33.7756, lng: -84.3963 };  // Midtown Atlanta
const offs: [string, number, number][] = [
  ['street to the north', 0.00025, 0],
  ['street to the east', 0, 0.0003],
  ['street to the south', -0.00025, 0],
  ['street to the west', 0, -0.0003],
  ['street to the south-west', -0.00018, -0.00021],
];

for (const [label, dlat, dlng] of offs) {
  const pano = { lat: house.lat + dlat, lng: house.lng + dlng };
  const deg = bearing(house, pano);
  console.log(
    `${label.padEnd(24)} bearing ${deg.toFixed(1).padStart(6)}°  ` +
    `${toCardinal(deg).padEnd(12)} ${metresBetween(house, pano).toFixed(0).padStart(3)}m  ` +
    `${nearSouth(deg) ? 'FLAG: leaning south' : ''}`,
  );
}

// The edge cases that decide whether a house lives or dies.
console.log('\nsector boundaries:');
for (const d of [150, 157, 158, 180, 202, 203, 210]) {
  console.log(`  ${String(d).padStart(3)}° -> ${toCardinal(d).padEnd(12)} ${nearSouth(d) ? 'near-south flag' : ''}`);
}
