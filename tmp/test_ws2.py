import asyncio, json, websockets, sys

# Get fresh token first
import urllib.request

req = urllib.request.Request(
    'http://localhost:3001/api/ws-token',
    data=b'{}',
    headers={'Content-Type': 'application/json'}
)
resp = urllib.request.urlopen(req)
token_data = json.loads(resp.read())
TOKEN = token_data['data']['token']
print(f'Got token: {TOKEN[:30]}...', flush=True)

async def test():
    uri = f'ws://localhost:3001/ws?token={TOKEN}'
    try:
        async with websockets.connect(uri) as ws:
            print('✅ WS connected!', flush=True)
            
            # Test ping
            await ws.send(json.dumps({'type': 'ping'}))
            resp = await asyncio.wait_for(ws.recv(), timeout=5)
            print(f'Ping response: {resp}', flush=True)
            
            # Now test SSH connect to a real host (if available)
            msg = {
                'type': 'connect',
                'connectionId': 'test-conn-2',
                'host': '192.168.2.9',
                'port': 22,
                'username': 'root',
                'password': 'test',
                'cols': 80,
                'rows': 24
            }
            await ws.send(json.dumps(msg))
            print('Sent SSH connect to 192.168.2.9', flush=True)
            
            try:
                resp = await asyncio.wait_for(ws.recv(), timeout=15)
                print(f'SSH response: {resp}', flush=True)
            except asyncio.TimeoutError:
                print('⏰ TIMEOUT waiting for SSH response!', flush=True)
                
    except Exception as e:
        print(f'❌ WS Error: {e}', flush=True)

asyncio.run(test())
