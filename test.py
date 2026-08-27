import paho.mqtt.client as mqtt
BROKER = "172.16.101.5"
PORT = 1883
TOPIC = "2233/7a502ab7-ec03-48bb-a9e4-e5ead965c307/response"

def on_connect(c, u, flags, rc, props=None):
    print("connected", rc)
    c.subscribe(TOPIC)

def on_message(c, u, msg):
    print(f"[{msg.topic}] {msg.payload.decode(errors='replace')}")

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
# client.username_pw_set("user", "pass")   # if auth required
client.on_connect = on_connect
client.on_message = on_message
client.connect(BROKER, PORT, 60)
client.loop_forever()