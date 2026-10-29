# Bambu printer: a real machine on the line

A Bambu 3D printer resolves an escalation row the way a person would. The unit route parks a print row on the printer's role. The gateway sends the file to the printer over MQTT and claims the row as the printer's bot. It notes the print's lifecycle on the row as the print runs, and resolves the row when the print finishes. A person then unloads the part. The workflow is the shipped `machineUnitRoute`, unchanged: it has no idea a printer is involved.

```
P1S (its own MQTT broker, :8883, user bblp + LAN access code)
  ⇅ Mosquitto bridge: report in, request out, under line/v1/<site>/<line>/<serial>/
machine broker (Mosquitto) ──bridge──▶ site NATS: JetStream keeps every report
                                            │
Long Tail: the gateway reads the stream, sends requests through the broker,
           and resolves rows as the printer's bot
```

## What a print leaves on the row

The printer reports about once a second. JetStream keeps all of it, and the print row gets only the milestones (the compose override turns lifecycle notes on, `MACHINE_LIFECYCLE=on`):

| Item | When |
|---|---|
| `started:<unit>` | The printer starts laying down material |
| `progress:<unit>:25`, `:50`, `:75` | The print crosses each step; the row's `progress` facet holds the latest percent, minutes left and layer |
| `paused:print-error:<at>` / `resumed:print-error:<at>` | The printer stops on an error (filament ran out, say), and later resumes |
| `arrived:<unit>` | The print finished; this resolves the row |

When the printer stops on an error, a `line-alarm` row also goes to `print-servicing`. It names the code and what to do, for example "The external spool ran out of filament". When someone fixes the printer and resumes, the printer clears the error and that row resolves itself. The print row stays parked throughout and resolves at the finish.

The printer is held until its part is unloaded. A second print waits unclaimed in the printer's queue, and goes out once the `print-unload` row is resolved.

A print that stops without finishing ends the print row as withdrawn, and a person decides on the `line-operator` row. The reason is `cancelled`, the printer's error code, or `did-not-print` (back to idle before printing, after a failed bed leveling, say).

If the printer drops off the network, a `machine-offline` row goes to `print-servicing`. The print row stays open. When the bridge reconnects, the gateway asks for the printer's full report, and a print that finished meanwhile resolves its row.

## Set up the printer

On the printer: **Settings → Network**, turn on **LAN Only**, then **Developer Mode**. The same screen shows the IP address and the **Access Code**. Without Developer Mode the printer reports its status but refuses prints from anything but Bambu's own software.

In Developer Mode a printer may not pause on its own filament runout sensor, and can print on with no filament. Watch prints in this mode, and turn Developer Mode and LAN Only off when you are done.

In `.env`, name the site and line and describe each printer; only enabled ones are bridged. `.env.example` lists the keys:

```
BAMBU_SITE_ID=site-1
BAMBU_LINE_ID=print-1
BAMBU_PRINTERS=p1s-01
BAMBU_P1S_01_SERIAL=<serial>
BAMBU_P1S_01_HOST=<printer IP>
BAMBU_P1S_01_CODE=<access code>
BAMBU_P1S_01_ENABLED=true
```

## Run it

```bash
docker compose -f docker-compose.yml -f docker-compose.nats.yml -f docker-compose.machines.yml \
  -f docker-compose.bambu.yml up -d --build
docker compose exec long-tail npm run bambu:print -- examples/workflows/bambu-printer/files/<part>.gcode.3mf
```

- **Setup:** `machine-site` renders the site into `deploy/bambu-site/`. That includes a bridge per printer, with the printer's CA read from the printer itself, and `line.json`.
- **The driver:** copies the file to the printer's storage over FTPS (`files.ts`), starts the route with that file as the unit's artifact, and prints the rows as they change. A printer on the LAN prints only files on its own storage. It runs in the Long Tail container, which reaches the printer.
- **The part:** clear the bed first. Use a file sliced for that printer, its nozzle and the filament loaded. Put it in `files/`, which is never checked in.
- **Unload:** when the print finishes, resolve the `print-unload` row on the dashboard.

## Layout

| Path | Holds |
|---|---|
| `codec.ts` | The Bambu protocol behind the `LineCodec` seam: reports to job, alarm, reply and presence events; dispatch, pause, resume, cancel and snapshot to printer requests |
| `report.ts` | The printer's report: the merged state, the print's phase, the job named in `subtask_name` |
| `catalog.ts` | What an error code means, for the alarm row |
| `files.ts` | Copies a print file to a printer's storage over FTPS |
| `env.ts` | The printers from `.env`, and the line they form |
| `site/` | The printer bridges, and the site setup that renders them |

Tests: `tests/examples/bambu-printer/codec.test.ts` decodes reports taken from a real printer. `tests/workflows/bambu-print-route.test.ts` runs the route on the real orchestrator against a simulated printer, covering a print, a runout, a refused print, and a second print waiting for the unload.
