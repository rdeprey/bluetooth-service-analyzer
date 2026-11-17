# Bluetooth Service Analyzer

A browser-based BLE inspector styled like a vintage electronic bench instrument.

[Open the analyzer](https://rdeprey.github.io/bluetooth-service-analyzer/)

Choose a device, listen for advertisements, then connect to inspect accessible primary GATT services and their characteristics. A dedicated button reads Battery Level when Battery Service is accessible.

## Try it

1. Open the analyzer over HTTPS in a browser with Web Bluetooth support.
2. Keep **Your device** selected, pick a filter, and click **Choose device**.
3. Click **Listen** to observe advertised service UUIDs, if supported.
4. Click **Connect**, then expand services to inspect characteristic UUIDs and operation flags.
5. Use **Disconnect**, **Stop listening**, or **Reset** to end the relevant operation.

The browser's API, OS, radio, site permissions, and device all affect results. Selection and connection are separate operations. The unfiltered picker is limited to devices the browser can discover through Web Bluetooth.

## What each panel means

- **Advertised services** accumulates UUIDs from received `advertisementreceived` events for the selected device during this session. The browser may filter these UUIDs by granted service permissions. Packet count, last reception time, and RSSI describe received events. Absence of packets differs from packets with no visible UUIDs.
- **Accessible services** lists `getPrimaryServices()` results after a GATT connection. This is a permission-limited list of primary services. Disclosures show characteristic metadata and supported operations. No characteristic writes are performed.
- **Service permissions** requests Battery, Device Information, Heart Rate, and Environmental Sensing, plus any custom UUIDs entered before selecting the device. Prior permissions for the site can remain granted. Reset clears the current session; browser settings manage persistent permissions.

Advertisement watching is experimental and is not available in every browser with basic Web Bluetooth support. Missing or rejected watching is shown separately from connection results. Some peripherals stop advertising while connected.

## Sample device

Choose **Sample device**, then **Choose device → Listen → Connect**. Sample mode is labeled throughout. Its deterministic sensor advertises Battery Service and exposes both Battery and Device Information. Read Battery returns 76%; RSSI is -57 dBm. These values are simulated.

The sample exercises the same analyzer logic with a small in-memory Bluetooth adapter. It does not scan your surroundings. Changing the source or resetting aborts listeners, clears observations, and disconnects the selected device.

## Development

No build step or application dependencies. Serve `docs/` with a static server, for example:

```sh
python3 -m http.server 4176 --bind 127.0.0.1 --directory docs
```

Open http://127.0.0.1:4176. Loopback is a secure context for local testing.

Run the focused tests with Node.js 22 or newer:

```sh
node --test test/*.test.mjs
```

Tests cover UUID validation, filtered request options, canceled selection, unsupported and failed advertisement watching, empty advertisements, reset during pending work, service discovery, reconnection, and battery reading. Browser UI testing uses Sample device. Physical Bluetooth interoperability requires testing with your own hardware.

GitHub Pages serves `docs/` from `main`. Google Fonts supplies the typefaces; device readings are held in tab memory and are not uploaded.

## References

- [Chrome's Web Bluetooth guide](https://developer.chrome.com/docs/capabilities/bluetooth)
- [Watch Advertisements sample](https://googlechrome.github.io/samples/web-bluetooth/watch-advertisements.html)
- [Web Bluetooth specification](https://webbluetoothcg.github.io/web-bluetooth/)
