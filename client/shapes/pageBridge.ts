import { CANVAS_KIT_CSS } from '../../shared/canvasKit'
/**
 * The bridge between the canvas and a sandboxed HTML page iframe.
 *
 * Each page iframe runs with sandbox="allow-scripts" (no allow-same-origin), so
 * the parent can't read its DOM. A small bootstrap script injected into every
 * page talks to the parent with postMessage:
 *
 *   page → parent  {__ccPage, type: 'size', w, h}          content size, for auto-height
 *   page → parent  {__ccPage, type: 'error', message}      uncaught script errors
 *   parent → page  {__ccPage, type: 'snapshot', id}        serialize the live DOM
 *   page → parent  {__ccPage, type: 'snapshot', id, html}  (canvases inlined as images)
 *   parent → page  {__ccPage, type: 'hitTest', id, boxes}  what's under these boxes?
 *   page → parent  {__ccPage, type: 'hitTest', id, hits}
 *
 * Snapshots let screenshots show what the page actually looks like after its
 * scripts ran; hit tests tell Claude which words the user circled or marked.
 */

export const PAGE_BOOTSTRAP = `
(function(){
  var K='__ccPage';
  function post(m){ m[K]=1; try{ parent.postMessage(m,'*') }catch(e){} }
  var lastW=0,lastH=0,t=null;
  function size(){
    var d=document.documentElement, b=document.body;
    if(!b) return;
    var h=Math.ceil(Math.max(b.scrollHeight, b.offsetHeight, d.offsetHeight));
    var w=Math.ceil(Math.max(b.scrollWidth, d.scrollWidth));
    if(Math.abs(h-lastH)>2||Math.abs(w-lastW)>2){ lastH=h; lastW=w; post({type:'size',w:w,h:h}); }
  }
  function sizeSoon(){ clearTimeout(t); t=setTimeout(size,60); }
  window.addEventListener('load', function(){ size(); setTimeout(size,400); setTimeout(size,1500); });
  document.addEventListener('DOMContentLoaded', function(){
    sizeSoon();
    try{ new ResizeObserver(sizeSoon).observe(document.body) }catch(e){}
  });
  window.addEventListener('error', function(e){ post({type:'error', message: String(e.message||e.error||'Script error')}) });
  window.addEventListener('unhandledrejection', function(e){ post({type:'error', message: 'Unhandled promise rejection: '+String(e.reason)}) });
  function snapshot(){
    var clone=document.documentElement.cloneNode(true);
    var live=document.querySelectorAll('canvas'), copies=clone.querySelectorAll('canvas');
    for(var i=0;i<live.length;i++){
      try{
        var img=document.createElement('img'); img.src=live[i].toDataURL('image/png');
        img.width=live[i].clientWidth||live[i].width; img.height=live[i].clientHeight||live[i].height;
        img.setAttribute('style', live[i].getAttribute('style')||'');
        copies[i].parentNode.replaceChild(img, copies[i]);
      }catch(e){}
    }
    var inputs=document.querySelectorAll('input,textarea,select'), cin=clone.querySelectorAll('input,textarea,select');
    for(var j=0;j<inputs.length;j++){
      var el=inputs[j], c=cin[j];
      if(el.type==='checkbox'||el.type==='radio'){ if(el.checked) c.setAttribute('checked',''); else c.removeAttribute('checked'); }
      else if(el.tagName==='TEXTAREA'){ c.textContent=el.value; }
      else if(el.tagName!=='SELECT'){ c.setAttribute('value', el.value); }
    }
    var s=clone.querySelectorAll('script'); for(var k=0;k<s.length;k++) s[k].parentNode.removeChild(s[k]);
    return clone.outerHTML;
  }
  // The word under a point (null if the point isn't over text).
  function wordAt(x,y){
    var r=document.caretRangeFromPoint?document.caretRangeFromPoint(x,y):null;
    if(!r||!r.startContainer||r.startContainer.nodeType!==3) return null;
    var t=r.startContainer.data, o=r.startOffset, s=o, e=o;
    while(s>0&&/\\S/.test(t[s-1])) s--; while(e<t.length&&/\\S/.test(t[e])) e++;
    if(s===e) return null;
    var rr=document.createRange(); rr.setStart(r.startContainer,s); rr.setEnd(r.startContainer,e);
    var b=rr.getBoundingClientRect();
    if(x<b.left-3||x>b.right+3||y<b.top-6||y>b.bottom+6) return null;
    return { word: t.slice(s,e), node: r.startContainer, start: s };
  }
  function wordsIn(b){
    var hits=[], pts=[];
    if(b.h<22){ for(var x=b.x; x<=b.x+b.w; x+=5) pts.push([x, b.y+b.h/2]); }
    else { var ix=b.x+b.w*0.12, iy=b.y+b.h*0.15, iw=b.w*0.76, ih=b.h*0.7; for(var i=0;i<=8;i++) for(var j=0;j<=5;j++) pts.push([ix+iw*i/8, iy+ih*j/5]); }
    for(var k=0;k<pts.length;k++){
      var w=wordAt(pts[k][0], pts[k][1]); if(!w) continue;
      if(!hits.some(function(h){ return h.node===w.node && h.start===w.start; })) hits.push(w);
    }
    hits.sort(function(a,b){ if(a.node===b.node) return a.start-b.start; return a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1; });
    return hits.map(function(h){ return h.word; }).join(' ').slice(0,200);
  }
  function textOf(el){ return (el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,160); }
  function hitTest(boxes){
    return boxes.map(function(b){
      var seen=[], out=[], opts=[], regions={};
      var steps=4, cx=b.x+b.w/2, cy=b.y+b.h/2;
      for(var i=0;i<=steps;i++) for(var j=0;j<=steps;j++){
        var x=b.x+b.w*i/steps, y=b.y+b.h*j/steps;
        var el=document.elementFromPoint(x,y);
        if(!el||el===document.body||el===document.documentElement) continue;
        var reg=el.closest('[data-cc-region]'); if(reg){ var rn=reg.getAttribute('data-cc-region'); regions[rn]=(regions[rn]||0)+1; }
        var opt=el.closest('[data-cc-option]'); if(opt && opts.indexOf(opt)===-1) opts.push(opt);
        if(seen.indexOf(el)!==-1) continue; seen.push(el);
        var txt=textOf(el); if(!txt) continue;
        if(out.indexOf(txt)===-1) out.push(txt);
      }
      // The choice a mark selects: the option whose centre is nearest the mark's centre.
      var choice=null, best=Infinity;
      for(var k=0;k<opts.length;k++){
        var r=opts[k].getBoundingClientRect(), d=Math.hypot(r.left+r.width/2-cx, r.top+r.height/2-cy);
        if(d<best){ best=d; choice=opts[k]; }
      }
      var region=null, most=0; for(var key in regions){ if(regions[key]>most){ most=regions[key]; region=key; } }
      var q=choice?choice.closest('[data-cc-question]'):null;
      return {
        texts: out.slice(0,6),
        words: wordsIn(b),
        choice: choice?{ question: q?q.getAttribute('data-cc-question'):null, option: choice.getAttribute('data-cc-option'), confirm: choice.hasAttribute('data-cc-confirm') }:null,
        region: region
      };
    });
  }
  window.addEventListener('message', function(e){
    if(e.source!==parent) return;
    var d=e.data; if(!d||!d[K]) return;
    if(d.type==='snapshot') post({type:'snapshot', id:d.id, html:snapshot()});
    if(d.type==='hitTest') post({type:'hitTest', id:d.id, hits:hitTest(d.boxes||[])});
  });
})();
`

/** Insert the design kit and the bootstrap script into Claude's HTML (full document or fragment). */
export function buildSrcDoc(html: string): string {
	const boot = `<script>${PAGE_BOOTSTRAP}</script>`
	// The kit comes first, so a page's own styles can override it.
	const base = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="cc-kit">${CANVAS_KIT_CSS}</style>`
	if (/<head[^>]*>/i.test(html)) {
		return html.replace(/<head[^>]*>/i, (m) => `${m}${base}${boot}`)
	}
	if (/<html[^>]*>/i.test(html)) {
		return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${base}${boot}</head>`)
	}
	return `<!doctype html><html><head>${base}${boot}</head><body>${html}</body></html>`
}

/** Strip scripts from HTML for static rendering (used when no live snapshot exists). Keeps the kit styles. */
export function stripScripts(html: string) {
	return buildStaticKit(html)
}

function buildStaticKit(html: string) {
	const kit = `<style id="cc-kit">${CANVAS_KIT_CSS}</style>`
	const withKit = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + kit) : kit + html
	return withKit.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

interface PageRecord {
	iframe: HTMLIFrameElement
	snapshot: string | null
	errors: string[]
}

const pages = new Map<string, PageRecord>()
const pending = new Map<string, (data: any) => void>()
let nextId = 1

type SizeListener = (shapeId: string, size: { w: number; h: number }) => void
let sizeListener: SizeListener | null = null

export function onPageSize(listener: SizeListener) {
	sizeListener = listener
}

export function registerPageIframe(shapeId: string, iframe: HTMLIFrameElement) {
	const existing = pages.get(shapeId)
	pages.set(shapeId, { iframe, snapshot: existing?.snapshot ?? null, errors: [] })
}

export function unregisterPageIframe(shapeId: string, iframe: HTMLIFrameElement) {
	const rec = pages.get(shapeId)
	if (rec && rec.iframe === iframe) pages.delete(shapeId)
}

export function getPageSnapshot(shapeId: string) {
	return pages.get(shapeId)?.snapshot ?? null
}

/** Script errors the page reported since the last time they were read. */
export function takePageErrors(shapeId: string): string[] {
	const rec = pages.get(shapeId)
	if (!rec) return []
	const errors = rec.errors
	rec.errors = []
	return errors
}

function findShapeIdForSource(source: MessageEventSource | null): string | null {
	for (const [id, rec] of pages) {
		if (rec.iframe.contentWindow === source) return id
	}
	return null
}

if (typeof window !== 'undefined') {
	window.addEventListener('message', (e) => {
		const d = e.data
		if (!d || typeof d !== 'object' || !d.__ccPage) return
		const shapeId = findShapeIdForSource(e.source)
		if (!shapeId) return
		const rec = pages.get(shapeId)!
		switch (d.type) {
			case 'size':
				if (typeof d.w === 'number' && typeof d.h === 'number') sizeListener?.(shapeId, { w: d.w, h: d.h })
				// The content changed; refresh the snapshot shortly after.
				setTimeout(() => void requestPageSnapshot(shapeId), 300)
				break
			case 'error':
				if (rec.errors.length < 10) rec.errors.push(String(d.message).slice(0, 300))
				break
			case 'snapshot':
			case 'hitTest': {
				const resolve = pending.get(`${d.type}:${d.id}`)
				if (resolve) {
					pending.delete(`${d.type}:${d.id}`)
					resolve(d)
				}
				if (d.type === 'snapshot' && typeof d.html === 'string') rec.snapshot = d.html
				break
			}
		}
	})
}

function ask<T>(shapeId: string, type: 'snapshot' | 'hitTest', payload: object, timeoutMs = 800): Promise<T | null> {
	const rec = pages.get(shapeId)
	const win = rec?.iframe.contentWindow
	if (!win) return Promise.resolve(null)
	const id = nextId++
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			pending.delete(`${type}:${id}`)
			resolve(null)
		}, timeoutMs)
		pending.set(`${type}:${id}`, (data) => {
			clearTimeout(timer)
			resolve(data)
		})
		win.postMessage({ __ccPage: 1, type, id, ...payload }, '*')
	})
}

export async function requestPageSnapshot(shapeId: string): Promise<string | null> {
	const res = await ask<{ html: string }>(shapeId, 'snapshot', {})
	return res?.html ?? getPageSnapshot(shapeId)
}

/** For each box (in page-local CSS px), the visible texts underneath it. */
export interface PageHit {
	texts: string[]
	/** The exact words under the mark (along a line's middle, or inside a circle). */
	words: string
	choice: { question: string | null; option: string; confirm: boolean } | null
	region: string | null
}

export async function hitTestPage(shapeId: string, boxes: { x: number; y: number; w: number; h: number }[]): Promise<PageHit[]> {
	if (boxes.length === 0) return []
	const res = await ask<{ hits: PageHit[] }>(shapeId, 'hitTest', { boxes })
	return res?.hits ?? boxes.map(() => ({ texts: [], words: '', choice: null, region: null }))
}

export function isPageMounted(shapeId: string) {
	return pages.has(shapeId)
}

if (typeof window !== 'undefined') {
	;(window as any).__pageBridge = { hitTestPage, isPageMounted, requestPageSnapshot, pages }
}
