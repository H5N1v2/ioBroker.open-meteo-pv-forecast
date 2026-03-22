# ioBroker Adapter Rules (TypeScript, Strict)

## 1. Core Rules (MANDATORY)

- NEVER use `any`
- ALWAYS use `async/await`
- ALWAYS use `try/catch` for async operations
- ALWAYS use `ack: true` when adapter writes states
- NEVER write states without checking existence
- NEVER write unchanged values

---

## 2. State Pattern (MANDATORY)

```ts
await this.setObjectNotExistsAsync(id, {
  type: "state",
  common: {
    name: "State",
    type: "number",
    role: "value.temperature",
    read: true,
    write: false
  },
  native: {}
});

const old = await this.getStateAsync(id);

if (old?.val !== value) {
  await this.setStateAsync(id, value, true);
}
```

---

## 3. Roles & Types (STRICT)

### Sensors
- type: boolean
- read: true
- write: false

Examples:
- sensor.motion
- sensor.door
- sensor.window

---

### Values
- type: number
- read: true
- write: false

Examples:
- value.temperature
- value.humidity
- value.power

---

### Switches
- type: boolean
- read: true
- write: true

Examples:
- switch.power
- switch.light

---

### Levels
- type: number
- read: true
- write: true

Examples:
- level.temperature
- level.dimmer

---

### Buttons (EVENTS!)
- type: boolean
- write: true
- read: false

Rules:
- MUST use `ack: true`
- NEVER expect reset to false

---

### Indicators
- type: boolean
- read: true
- write: false

Examples:
- indicator.reachable
- indicator.lowbat

---

## 4. onStateChange Pattern

```ts
async onStateChange(id: string, state: ioBroker.State | null | undefined) {
  if (!state || state.ack) return;

  try {
    if (id.endsWith("switch.power")) {
      await this.handlePower(state.val as boolean);
      await this.setStateAsync(id, state.val, true);
    }
  } catch (error) {
    this.log.error(`Command failed: ${error}`);
  }
}
```

---

## 5. Lifecycle

### onUnload MUST clean everything

```ts
if (this.interval) clearInterval(this.interval);
```

---

## 6. Forbidden

❌ any  
❌ callbacks  
❌ setState without ack  
❌ writing unchanged values  
❌ wrong role/type combinations  
❌ wildcard subscriptions without need  

---

## 7. Mental Model

- ioBroker = state database
- Adapter = sync layer (API ↔ states)