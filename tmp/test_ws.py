import asyncio, json, websockets

TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjbGllbnQiLCJpYXQiOjE3ODM5NDQ0MzMsImV4cCI6MTc4NDAzMDgzMywic2NvcGUiOiJhcGkrd3MifQ.hCCoNbZqLbVY_yEVTbpuL3jiQ-HZvfvWqHX1NHyNbAg"

async def test():
    uri = f'ws://localhost:3001/ws?token={TOKEN}'
    try:
        async with websockets.connect(uri) as ws:
            print('WS connected!', flush=True)
            msg = {
                'type': 'connect',
                'connectionId': 'test-conn-1',
                'host': '127.0.0.1',
                'port': 22,
                'username': 'root',
                'password': 'test',
                'cols': 80,
                'rows': 24
            }
            await ws.send(json.dumps(msg))
            print('Sent connect message', flush=True)
            try:
                resp = await asyncio.wait_for(ws.recv(), timeout=15)
                print(f'Response: {resp}', flush=True)
            except asyncio.TimeoutError:
                print('TIMEOUT waiting for response!', flush=True)
    except Exception as e:
        print(f'WS Error: {e}', flush=True)

asyncio.run(test())
