// Language features are bought in the Lab, so the parser has to know which parts
// of the grammar the player currently owns. Ids here match tech-tree entry ids.

export const FEATURE_LABELS = {
  loops: 'Loops',
  seeding: 'Seeding',
  branching: 'Branching',
  reef1: 'Expand Reef I',
  counting: 'Counting',
  anemones: 'Anemones',
  sensors: 'Sensors',
  functions: 'Functions',
  scrubber: 'Scrubber',
  lists: 'Lists',
  reef2: 'Expand Reef II',
  coral: 'Coral Bloom',
  shells: 'Shell Sort',
  drones: 'Second Drone',
};

export const featureLabel = (id) => FEATURE_LABELS[id] || id;
