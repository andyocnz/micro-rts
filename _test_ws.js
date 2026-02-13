import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:8080');
ws.on('open', () => { console.log('CONNECTED OK'); });
ws.on('message', d => console.log('MSG:', d.toString()));
ws.on('error', e => console.log('ERROR:', e.message));
ws.on('close', () => { console.log('CLOSED'); process.exit(0); });
setTimeout(() => { console.log('TIMEOUT - no response'); process.exit(1); }, 3000);
