import { browserSupport, canReadBattery } from './support.mjs';
import { Analyzer, requestOptions, serviceName, names, uuid, characteristicDescription, describeOperations } from './bluetooth.mjs';
import { sampleBluetooth } from './sample.mjs';

const el = id => document.getElementById(id);
let sample = false;
let renderedServices = '';
let renderedAdvertisements = '';
let available;
const policy = document.permissionsPolicy || document.featurePolicy;
const policyAllowed = !policy?.allowsFeature || policy.allowsFeature('bluetooth');

function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}
function render(state) {
  el('device-name').textContent = state.name;
  el('connection').textContent = state.connection;
  el('status').textContent = state.message;
  el('source-label').textContent = sample ? 'Sample device · simulated data' : 'Live device';
  const support = browserSupport({ secure: isSecureContext, bluetooth: navigator.bluetooth, policyAllowed, available, blocked: state.bluetoothBlocked });
  el('browser-notice').hidden = sample;
  el('browser-notice').classList.toggle('warning', support.warning);
  el('support-title').textContent = support.title;
  el('support').textContent = support.message;
  el('choose').disabled = state.busy || (!sample && !support.canChoose);
  el('options').disabled = state.busy;
  el('listen').disabled = !state.advertisementSupported;
  el('listen').textContent = state.watching ? 'Stop listening' : 'Listen';
  el('connect').disabled = !analyzer?.device || state.busy;
  el('disconnect').disabled = state.connection !== 'Connected';
  el('battery-controls').hidden = !canReadBattery(state, uuid);
  el('read-battery').disabled = state.busy;
  el('ad-status').textContent = state.advertisementStatus;
  el('service-status').textContent = state.serviceStatus;
  el('advertised-count').textContent = state.packets ? String(state.advertised.length).padStart(2, '0') : '—';
  el('accessible-count').textContent = state.connection === 'Connected' && !state.busy ? String(state.accessible.length).padStart(2, '0') : '—';
  el('packets').textContent = state.packets ? state.packets + ' packets · last ' + state.lastSeen : 'No packets received';
  el('rssi').textContent = state.rssi === null ? 'No signal measurement' : state.rssi + ' dBm';
  el('needle').style.setProperty('--signal', state.rssi === null ? '0%' : Math.max(0, Math.min(100, (state.rssi + 100) / 80 * 100)) + '%');
  el('battery-value').textContent = state.battery === null ? '—' : state.battery + '%';
  el('session-note').textContent = sample ? 'Sample mode · generated readings' : 'Select → listen → connect → inspect';

  // Preserve open disclosures and focus while advertisement counters update.
  const advertised = JSON.stringify(state.advertised);
  if (advertised !== renderedAdvertisements) {
    renderedAdvertisements = advertised;
    el('advertised').replaceChildren(...state.advertised.map(id => {
      const row = document.createElement('li');
      row.append(text('strong', serviceName(id)), text('code', id));
      return row;
    }));
  }
  const services = JSON.stringify(state.accessible);
  if (services !== renderedServices) {
    renderedServices = services;
    el('accessible').replaceChildren(...state.accessible.map(service => {
      const row = document.createElement('details');
      row.className = 'service';
      const summary = document.createElement('summary');
      summary.append(text('strong', serviceName(service.uuid)), text('code', service.uuid));
      row.append(summary);
      if (service.error) row.append(text('p', service.error));
      for (const characteristic of service.characteristics) {
        const section = text('div', '', 'characteristic');
        section.append(
          text('strong', names.get(characteristic.uuid) || 'Unidentified characteristic'),
          text('code', characteristic.uuid),
          text('p', characteristicDescription(characteristic.uuid)),
          text('p', describeOperations(characteristic.operations), 'characteristic-operations')
        );
        row.append(section);
      }
      if (!service.error && !service.characteristics.length) row.append(text('p', 'No accessible characteristics returned.'));
      return row;
    }));
  }
}
let analyzer;
analyzer = new Analyzer(navigator.bluetooth);
analyzer.changed = render;
render(analyzer.state);

for (const radio of document.querySelectorAll('[name="source"]')) {
  radio.addEventListener('change', () => {
    analyzer.reset();
    sample = el('sample').checked;
    analyzer.bluetooth = sample ? sampleBluetooth() : navigator.bluetooth;
    render(analyzer.state);
  });
}
el('custom').addEventListener('input', () => el('custom').setCustomValidity(''));
el('choose').addEventListener('click', () => {
  let options;
  try {
    options = requestOptions(document.querySelector('[name="filter"]:checked').value, el('custom').value);
  } catch (error) {
    el('custom').setCustomValidity(error.message);
    el('custom').closest('details').open = true;
    el('custom').reportValidity();
    return;
  }
  void analyzer.choose(options);
});
el('listen').addEventListener('click', () => analyzer.state.watching ? analyzer.stopListening() : void analyzer.listen());
el('connect').addEventListener('click', () => void analyzer.connect());
el('disconnect').addEventListener('click', () => analyzer.disconnect());
el('read-battery').addEventListener('click', () => void analyzer.readBattery());
el('reset').addEventListener('click', () => analyzer.reset());
window.addEventListener('pagehide', () => analyzer.reset());

// An unavailable adapter is not the same as an unsupported API; keep retries possible.
let availabilityCheck = 0;
async function checkAvailability() {
  const check = ++availabilityCheck;
  try {
    const value = await navigator.bluetooth?.getAvailability?.();
    if (check !== availabilityCheck) return;
    available = value;
  } catch {
    if (check !== availabilityCheck) return;
    available = undefined;
  }
  render(analyzer.state);
}
navigator.bluetooth?.addEventListener?.('availabilitychanged', checkAvailability);
window.addEventListener('focus', checkAvailability);
void checkAvailability();
el('try-sample').addEventListener('click', () => {
  el('sample').checked = true;
  el('sample').dispatchEvent(new Event('change'));
  el('choose').focus();
});
