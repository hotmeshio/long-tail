# The boat

`p1s-0.8-tpu.gcode.3mf` is [#3DBenchy](https://www.3dbenchy.com) by Creative Tools, scaled to half size and sliced with OrcaSlicer 2.4.2 for a Bambu Lab P1S with a 0.8 nozzle and TPU: 0.4 mm layers, 60 layers, 1.17 g, about 11 minutes, Textured PEI Plate.

#3DBenchy is in the public domain under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). The model comes from [3DBenchy.com](https://www.3dbenchy.com).

| File | Holds |
|---|---|
| `presets/tpu-0.8-filament.json` | The filament preset (`lt tpu`): OrcaSlicer's `Generic TPU for AMS @BBL X1C` at 250 °C, flow 0.5, 12 mm³/s |
| `presets/tpu-0.8-process.json` | The process preset (`lt tpu process`): OrcaSlicer's `0.40mm Standard @BBL X1C 0.8 nozzle`, 4 walls, 50% infill, no prime tower |

`npm run bambu:boat` with these presets slices the same file again; the example's README has the command.
