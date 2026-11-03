const evidenceBody = document.querySelector('#evidence-body');
const poolsBody = document.querySelector('#pools-body');
const detail = document.querySelector('#detail');
const dashboardMain = document.querySelector('main');
const databaseState = document.querySelector('#database-state');
const updatedAt = document.querySelector('#updated-at');
const intentForm = document.querySelector('#intent-form');
const intentAssetIn = document.querySelector('#intent-asset-in');
const intentAssetOut = document.querySelector('#intent-asset-out');
const intentBroadcast = document.querySelector('#intent-broadcast');
const intentSubmit = document.querySelector('#intent-submit');
const intentResult = document.querySelector('#intent-result');
const intentOwner = document.querySelector('#intent-owner');
const intentHelp = document.querySelector('#intent-help');
let evidence = [];
let intentConfig = null;

const STATUS_META = {
  confirmed: { className: 'confirmed', label: 'Confirmed' },
  finalized: { className: 'confirmed', label: 'Confirmed' },
  complete: { className: 'confirmed', label: 'Completed' },
  completed: { className: 'confirmed', label: 'Completed' },
  pending: { className: 'pending', label: 'Processing' },
  queued: { className: 'pending', label: 'Queued' },
  simulated: { className: 'pending', label: 'Simulated' },
  submitted: { className: 'submitted', label: 'Submitted' },
  rejected: { className: 'rejected', label: 'Rejected' },
  failed: { className: 'failed', label: 'Failed' },
  error: { className: 'failed', label: 'Failed' },
};

function statusMeta(value) {
  const raw = String(value ?? '').trim();
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
  return STATUS_META[key] ?? { className: 'unknown', label: raw || 'Unknown' };
}

function normalizeQuery(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^0x/, '');
}

function setDatabaseState(message, state) {
  databaseState.textContent = message;
  databaseState.dataset.state = state;
}

function setTableBusy(isBusy) {
  document.querySelectorAll('.table-wrap').forEach((table) => {
    table.setAttribute('aria-busy', String(isBusy));
  });
}

function resetSummary(message) {
  document.querySelector('#metric-run').textContent = '—';
  document.querySelector('#metric-runtime').textContent = message;
  document.querySelector('#metric-pools').textContent = '—';
  document.querySelector('#metric-evidence').textContent = '—';
  document.querySelector('#metric-status').textContent = message;
  document.querySelector('#metric-latency').textContent = '—';
  document.querySelector('#snapshot-block').textContent = message;
  document.querySelector('#requirement-transactions').textContent = '—';
  document.querySelector('#requirement-deployments').textContent = '—';
  document.querySelector('#requirement-performance').textContent = '—';
}

function make(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function shortHash(value) {
  const normalized = hashHex(value);
  if (!normalized) return 'Unsubmitted';
  return `${normalized.slice(0, 10)}…${normalized.slice(-8)}`;
}

function hashHex(value) {
  if (typeof value === 'string') return value.replace(/^0x/, '').toLowerCase();
  if (Array.isArray(value)) return value.map((byte) => Number(byte).toString(16).padStart(2, '0')).join('');
  return '';
}

function formatAmount(value) {
  if (value === undefined || value === null) return '—';
  return String(value);
}

function shortAddress(value) {
  const text = String(value ?? '');
  return text.length > 16 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
}

function showIntentResult(title, details, kind = '') {
  intentResult.hidden = false;
  intentResult.className = `intent-result ${kind}`.trim();
  intentResult.replaceChildren(make('strong', title));
  intentResult.append(make('div', details));
}

function renderIntentAssets() {
  if (!intentConfig?.assets?.length) {
    intentOwner.textContent = 'No deployed assets available';
    intentSubmit.disabled = true;
    return;
  }
  const options = intentConfig.assets.map((asset) => ({
    value: asset.address,
    label: `${asset.label} · ${shortAddress(asset.address)}`,
  }));
  for (const select of [intentAssetIn, intentAssetOut]) {
    select.replaceChildren(...options.map((option) => {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      return element;
    }));
  }
  if (options.length > 1) intentAssetOut.value = options[1].value;
  intentOwner.textContent = intentConfig.owner ? `Owner ${shortAddress(intentConfig.owner)}` : 'Account not configured';
  if (!intentConfig.owner) intentSubmit.disabled = true;
  if (!intentConfig.allowBroadcast) {
    intentBroadcast.disabled = true;
    intentHelp.textContent = 'Dry-run is the default. Broadcast is disabled for this server process.';
  }
}

async function loadIntentConfig() {
  try {
    const response = await fetch('/api/intent/config', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'intent configuration unavailable');
    intentConfig = payload;
    renderIntentAssets();
  } catch (error) {
    intentOwner.textContent = 'Intent service unavailable';
    intentSubmit.disabled = true;
    intentHelp.textContent = error.message;
  }
}

async function submitIntent(event) {
  event.preventDefault();
  if (!intentConfig) return;
  const formData = new FormData(intentForm);
  const payload = {
    assetIn: formData.get('assetIn'),
    assetOut: formData.get('assetOut'),
    amountIn: formData.get('amountIn'),
    amountOutMin: formData.get('amountOutMin'),
    maxFee: formData.get('maxFee'),
    maxHops: Number(formData.get('maxHops')),
    broadcast: intentBroadcast.checked,
  };
  const deadline = String(formData.get('deadline') ?? '').trim();
  if (deadline) payload.deadline = deadline;
  intentSubmit.disabled = true;
  intentResult.hidden = true;
  try {
    const response = await fetch('/api/intents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'intent submission failed');
    const record = result.record;
    const route = record?.route?.steps?.length ? `${record.route.steps.length} hop route` : 'No route';
    const tx = record?.execution?.tx_id ?? record?.execution?.tx_hash;
    const detail = [
      `${result.status} · ${route}`,
      record?.quote?.amount_out ? `Quoted output ${record.quote.amount_out}` : null,
      tx ? `Transaction ${shortAddress(tx)}` : record?.failure_reason ? `Reason ${record.failure_reason}` : null,
    ].filter(Boolean).join(' · ');
    showIntentResult('Intent accepted', detail, result.status === 'Confirmed' ? 'success' : '');
    await refresh();
  } catch (error) {
    showIntentResult('Intent rejected', `${error.message} Try minimum output 0 and a larger maximum fee to inspect the live quote.`, 'error');
  } finally {
    intentSubmit.disabled = false;
  }
}

function renderPools(pools, emptyMessage = 'No pool snapshot saved yet') {
  poolsBody.replaceChildren();
  if (!pools.length) {
    const row = make('tr');
    const cell = make('td', emptyMessage, 'empty');
    cell.colSpan = 5;
    row.append(cell);
    poolsBody.append(row);
    return;
  }
  for (const item of pools) {
    const snapshot = item.snapshot ?? item;
    const row = make('tr');
    const address = snapshot.pool_id?.Contract ?? snapshot.pool_id ?? item.pool_address;
    const assets = `${assetLabel(snapshot.asset_0 ?? item.token0)} → ${assetLabel(snapshot.asset_1 ?? item.token1)}`;
    const reserves = `${formatAmount(snapshot.reserve_0)} / ${formatAmount(snapshot.reserve_1)}`;
    const values = [
      [shortHash(address), 'mono'],
      [assets, ''],
      [reserves, 'mono numeric'],
      [`${snapshot.fee_bps ?? item.fee_bps ?? '—'} bps`, 'mono numeric'],
      [snapshot.observed_at?.number ?? item.observed_block ?? '—', 'mono numeric'],
    ];
    for (const [value, className] of values) row.append(make('td', String(value), className));
    poolsBody.append(row);
  }
}

function assetLabel(asset) {
  if (typeof asset === 'string') return asset;
  if (asset?.Native !== undefined) return 'Native';
  if (asset?.Contract) return shortHash(asset.Contract);
  return 'Unknown asset';
}

function renderEvidence(emptyMessage = 'No execution evidence yet') {
  const query = normalizeQuery(document.querySelector('#search').value);
  const filtered = evidence.filter((item) => {
    const joined = [hashHex(item.execution?.intent_id), hashHex(item.route_hash), hashHex(item.execution?.tx_hash)].join(' ');
    return joined.includes(query);
  });
  evidenceBody.replaceChildren();
  if (!filtered.length) {
    const row = make('tr');
    const cell = make('td', evidence.length ? 'No matching evidence' : emptyMessage, 'empty');
    cell.colSpan = 7;
    row.append(cell);
    evidenceBody.append(row);
    return;
  }
  for (const item of filtered) {
    const row = make('tr', undefined, 'selectable');
    const quote = item.quote;
    const tx = item.execution?.tx_hash;
    const receipt = item.receipt;
    const status = statusMeta(item.execution?.status);
    const result = item.failure_reason ?? receipt?.failure_reason ?? (receipt?.success ? 'Execution succeeded' : 'Unsubmitted');
    const values = [
      [shortHash(item.execution?.intent_id), 'mono'],
      [status.label, `status ${status.className}`],
      [quote ? `${quote.amount_out} / ${quote.score}` : '—', 'numeric'],
      [shortHash(item.route_hash), 'mono'],
      [shortHash(tx), 'mono'],
      [receipt ? `${receipt.block?.number ?? '—'} / ${item.events?.length ?? 0}` : '—', 'numeric'],
      [result, ''],
    ];
    for (const [index, [value, className]] of values.entries()) {
      const cell = make('td', String(value), className === 'mono' ? 'mono' : className === 'numeric' ? 'numeric' : '');
      if (index === 1) {
        cell.replaceChildren(make('span', String(value), className));
      }
      row.append(cell);
    }
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-controls', 'detail');
    row.setAttribute('aria-label', `View execution evidence ${shortHash(item.execution?.intent_id)}`);
    row.addEventListener('click', () => renderDetail(item));
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      renderDetail(item);
    });
    evidenceBody.append(row);
  }
}

function renderDetail(item) {
  detail.hidden = false;
  detail.replaceChildren();
  const grid = make('div', undefined, 'detail-grid');
  const status = statusMeta(item.execution?.status);
  const entries = [
    ['Intent', hashHex(item.execution?.intent_id)],
    ['Execution status', status.label],
    ['Input fingerprint', hashHex(item.input_hash)],
    ['Route hash', hashHex(item.route_hash)],
    ['Commitment', hashHex(item.execution?.commitment_hash)],
    ['Input amount', item.intent?.amount_in ?? '—'],
    ['Minimum output', item.intent?.amount_out_min ?? '—'],
    ['Deadline block', item.intent?.deadline ?? '—'],
    ['Transaction hash', hashHex(item.execution?.tx_hash) || 'Unsubmitted'],
    ['Block hash', hashHex(item.execution?.block_hash) || 'Unconfirmed'],
    ['Simulation duration', item.simulation_duration_ms === null ? '—' : `${item.simulation_duration_ms} ms`],
    ['Submission duration', item.submission_duration_ms === null ? '—' : `${item.submission_duration_ms} ms`],
    ['Failure reason', item.failure_reason ?? 'None'],
  ];
  for (const [label, value] of entries) {
    const cell = make('div', undefined, 'detail-item');
    cell.append(make('span', label), make('strong', String(value ?? '—')));
    grid.append(cell);
  }
  detail.append(grid);
  if (item.route?.steps?.length) {
    const routes = make('ol', undefined, 'route-steps');
    for (const [index, step] of item.route.steps.entries()) {
      routes.append(make('li', `${index + 1}. ${shortHash(step.pool_id)} · ${assetLabel(step.asset_in)} → ${assetLabel(step.asset_out)}`));
    }
    detail.append(routes);
  }
  if (item.quote?.risk_fields) {
    detail.append(make('pre', JSON.stringify(item.quote.risk_fields, null, 2), 'risk-details'));
  }
  if (item.events?.length) {
    const events = make('ul', undefined, 'event-list');
    for (const event of item.events) {
      const payload = Array.isArray(event.data) ? event.data.map((byte) => Number(byte).toString(16).padStart(2, '0')).join('') : '';
      events.append(make('li', `${event.pallet}::${event.event} · #${event.event_index} · 0x${payload}`));
    }
    detail.append(events);
  }
  detail.focus({ preventScroll: true });
}

function average(values) {
  return values.length ? `${Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)} ms` : '--';
}

async function refresh() {
  const refreshButton = document.querySelector('#refresh');
  refreshButton.disabled = true;
  dashboardMain.setAttribute('aria-busy', 'true');
  setTableBusy(true);
  setDatabaseState('Reading local evidence store', 'loading');
  updatedAt.textContent = 'Reading';
  evidence = [];
  detail.hidden = true;
  detail.replaceChildren();
  renderEvidence('Loading execution evidence');
  renderPools([], 'Loading pool state');
  try {
    const response = await fetch('/api/overview', { cache: 'no-store' });
    if (!response.ok) throw new Error(`overview request failed: ${response.status}`);
    const snapshot = await response.json();
    if (!snapshot || typeof snapshot !== 'object') throw new Error('overview response is invalid');
    evidence = Array.isArray(snapshot.evidence) ? snapshot.evidence : [];
    const pools = Array.isArray(snapshot.pools) ? snapshot.pools : [];
    const readFailure = snapshot.database === 'unavailable';
    renderEvidence(readFailure ? 'Failed to load execution evidence' : undefined);
    renderPools(pools, readFailure ? 'Failed to load pool state' : undefined);
    const confirmed = evidence.filter((item) => statusMeta(item.execution?.status).className === 'confirmed').length;
    const finalized = evidence.filter((item) => item.receipt?.tx_hash).length;
    const dryRuns = evidence.map((item) => item.simulation_duration_ms).filter(Number.isFinite);
    const latestRun = snapshot.runs?.[0];
    if (readFailure) {
      setDatabaseState('Evidence store unavailable', 'error');
      resetSummary('Temporarily unavailable');
    } else {
      const databaseLabel = snapshot.databaseFile ? ` · ${snapshot.databaseFile}` : '';
      setDatabaseState(snapshot.database === 'ready' ? `Evidence store connected${databaseLabel}` : 'Local evidence store not created', snapshot.database === 'ready' ? 'ready' : 'missing');
      document.querySelector('#metric-run').textContent = latestRun?.run_id ?? 'Not collected';
      document.querySelector('#metric-runtime').textContent = latestRun?.runtime_version ?? 'Runtime information not collected';
      document.querySelector('#metric-pools').textContent = String(pools.length);
      document.querySelector('#metric-evidence').textContent = String(evidence.length);
      document.querySelector('#metric-status').textContent = `${confirmed} confirmed transaction${confirmed === 1 ? '' : 's'}`;
      document.querySelector('#metric-latency').textContent = average(dryRuns);
      document.querySelector('#snapshot-block').textContent = latestRun?.end_block ? `Latest block ${latestRun.end_block}` : 'No block snapshot yet';
      document.querySelector('#requirement-transactions').textContent = `${finalized} / 10`;
      const deployments = Array.isArray(snapshot.deployments) ? snapshot.deployments : [];
      document.querySelector('#requirement-deployments').textContent = deployments.length ? `${deployments.length} record${deployments.length === 1 ? '' : 's'}` : 'Not collected';
      document.querySelector('#requirement-performance').textContent = dryRuns.length ? `${dryRuns.length} sample${dryRuns.length === 1 ? '' : 's'}` : 'Not collected';
    }
    updatedAt.textContent = `Updated ${new Date().toLocaleTimeString('en-GB', { hour12: false })}`;
  } catch {
    evidence = [];
    detail.hidden = true;
    detail.replaceChildren();
    setDatabaseState('Local API unavailable', 'error');
    renderEvidence('Failed to load execution evidence');
    renderPools([], 'Failed to load pool state');
    resetSummary('Read failed');
    updatedAt.textContent = 'Update failed';
  } finally {
    dashboardMain.setAttribute('aria-busy', 'false');
    setTableBusy(false);
    refreshButton.disabled = false;
  }
}

document.querySelector('#refresh').addEventListener('click', refresh);
document.querySelector('#search').addEventListener('input', renderEvidence);
intentForm.addEventListener('submit', submitIntent);
loadIntentConfig();
refresh();
