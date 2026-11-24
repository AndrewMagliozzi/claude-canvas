import { ActionStreamParser, closeAndParseJson } from '../claude/parseActions'
const html = '<script>const s = "a\\\\"; const md = "```js```"; if (x < 3) { alert("hi") }</script>\n<div style="color:red">é back\\</div>'
const json = JSON.stringify({ actions: [{ _type: 'message', text: 'hi "there"' }, { _type: 'page', html, w: 800 }, { _type: 'camera', x: 1 }] })
const full = 'Sure!\n```json\n' + json + '\n```\nDone.'
const p = new ActionStreamParser(); const out: any[] = []
for (let i = 0; i < full.length; i += 3) for (const a of p.push(full.slice(i, i + 3))) out.push(a)
for (const a of p.finish()) out.push(a)
const completes = out.filter(a => a.complete)
console.log('completes:', completes.map(a => a._type), 'incomplete count:', out.length - completes.length)
console.log('html roundtrip ok:', completes[1].html === html)
console.log(closeAndParseJson('{"a": "x\\\\'), closeAndParseJson('{"a": "\\u00'), closeAndParseJson('{"a": [1, 2,'), closeAndParseJson('{"a": 1, "b":'))
const fs = await import('node:fs')
const rawPath = process.env.RAW
if (rawPath) {
	const raw = fs.readFileSync(rawPath, 'utf8')
	const p2 = new ActionStreamParser(); const out2: any[] = []
	for (let i = 0; i < raw.length; i += 7) for (const a of p2.push(raw.slice(i, i + 7))) out2.push(a)
	for (const a of p2.finish()) out2.push(a)
	console.log('malformed sample completes:', out2.filter((a) => a.complete).map((a) => a._type))
}
const p3 = new ActionStreamParser(); const o3: any[] = []
for (const a of p3.push('{"actions":[{"_type":"text","shapeId":"n","text":"hi","x":1,"y":2,"intent":"note"},{"_type":"camera","x":0}]}')) o3.push(a)
for (const a of p3.finish()) o3.push(a)
console.log('normalized:', JSON.stringify(o3.filter((a) => a.complete).map((a) => [a._type, a.shape?._type])))
const redo = '{"actions":[{"_type":"create","intent":"a","shape":{"_type":"text","shapeId":"n1","text":"v1","x":1,"y":2,"_unused":null}}]}\n\nActually I must not include extra fields. Redo:\n\n{"actions":[{"_type":"create","intent":"a","shape":{"_type":"text","shapeId":"n1","text":"v2","x":1,"y":2}},{"_type":"create","intent":"b","shape":{"_type":"arrow","shapeId":"a1","x1":0,"y1":0,"x2":5,"y2":5}},{"_type":"page","shapeId":"pg","html":"<p>x</p>"},{"_type":"camera","x":0,"y":0,"w":10,"h":10}]}'
const p4 = new ActionStreamParser(); const o4: any[] = []
for (let i = 0; i < redo.length; i += 5) for (const a of p4.push(redo.slice(i, i + 5))) o4.push(a)
for (const a of p4.finish()) o4.push(a)
console.log('redo completes:', JSON.stringify(o4.filter((a) => a.complete).map((a) => a._type + ':' + (a.shape?.shapeId ?? a.shapeId ?? ''))), 'n1 incompletes after doc1:', o4.filter((a, i) => !a.complete && a.shape?.text === 'v2').length)
process.exit(0)
