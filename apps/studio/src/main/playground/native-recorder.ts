/** Serialized into each document. Capture in the event's capture phase, before
 * React mutates the DOM. This listener never cancels or repeats a user action. */
export function nativeRecorderScript(
  captureSource: string,
  binding: string,
  control: string,
) {
  return `(() => {
    if (window[${JSON.stringify(control)}]) return;
    ${captureSource}
    const send = window[${JSON.stringify(binding)}];
    const listeners = [], deliveries = new Set();
    const documentId = Math.random().toString(36).slice(2), targetIds = new WeakMap();
    let nextTargetId=0, pendingElement, recordedOnMouseDown=false;
    const targetId = el => {if(!el || typeof el!=='object')return undefined;if(!targetIds.has(el))targetIds.set(el,++nextTargetId);return documentId+':'+targetIds.get(el);};
    let pendingInput, inputTimer, pendingScroll, scrollTimer, start, releasedTarget, downTime, dragged = false;
    const on = (type, fn) => { window.addEventListener(type, fn, true); listeners.push([type, fn]); };
    const point = e => ({ x:e.clientX, y:e.clientY });
    const targetPoint = element => { const r = element.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; };
    const safeCapture = payload => {try{return capture(payload,fallback);}catch{return {error:'录制定位采集失败，需要 Agent 执行。'};}};
    const packet = (payload, nativeTarget) => ({payload, nativeTarget:nativeTarget || safeCapture(payload), url:location.href, title:document.title, width:innerWidth,height:innerHeight,subframe:window!==window.top});
    const emit = item => { const delivery=send(item);deliveries.add(delivery);void delivery.finally(()=>deliveries.delete(delivery)).catch(() => {}); };
    const flushInput = () => { clearTimeout(inputTimer); if(pendingInput) {emit(pendingInput);pendingInput=undefined;} pendingElement=undefined; };
    const flushScroll = () => {clearTimeout(scrollTimer);if(pendingScroll){emit(pendingScroll);pendingScroll=undefined;}};
    const flush = () => {flushInput();flushScroll();};
    on('pointerdown', e => {if(!e.isTrusted) return; recordedOnMouseDown=false;flushInput();flushScroll(); start={...point(e), target:safeCapture({actionType:'Tap',...point(e)})};releasedTarget=undefined;downTime=Date.now();dragged=false;});
    // rc-select clears on mousedown and can unmount this icon before click exists.
    // Only this known press-activated control is captured early; ordinary controls
    // still require click, so cancelled presses and drags aren't recorded as taps.
    on('mousedown', e => {
      if(!e.isTrusted || e.button!==0)return;
      const el=e.composedPath?.()[0] || e.target;
      const clear=el?.closest?.('.ant-select-clear');
      if(!clear || clear.closest('.ant-select-disabled,[aria-disabled="true"]'))return;
      flush();recordedOnMouseDown=true;
      const item=packet({actionType:'Tap',...point(e)},start?.target);
      item.clickTarget=targetId(clear);item.clickCount=1;
      emit(item);
    });
    on('pointerup', e => {
      if(!e.isTrusted || !start || e.button!==0) return;
      if(recordedOnMouseDown){start=undefined;releasedTarget=undefined;return;}
      if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>8) {
        dragged=true; const p={actionType:'DragAndDrop',x:start.x,y:start.y,endX:e.clientX,endY:e.clientY};
        emit(packet(p,{...start.target,dropTarget:safeCapture({actionType:'Tap',...point(e)})}));
      }
      releasedTarget=start.target;start=undefined;
    });
    on('click', e => {if(!e.isTrusted) return;if(recordedOnMouseDown && e.detail>0){recordedOnMouseDown=false;releasedTarget=undefined;downTime=undefined;return;}if(dragged){dragged=false;return;} flush();
      const duration=Date.now()-downTime;
      const item=packet({actionType:e.detail>0&&duration>600?'LongPress':'Tap',...point(e),...(e.detail>0&&duration>600?{duration}: {})},releasedTarget);
      item.clickTarget=targetId(e.composedPath?.()[0] || e.target);item.clickCount=e.detail;
      emit(item);releasedTarget=undefined;downTime=undefined;
    });
    on('contextmenu', e => {if(e.isTrusted){flush();emit(packet({actionType:'RightClick',...point(e)}));}});
    on('input', e => {
      if(!e.isTrusted || e.isComposing) return;
      const el=e.composedPath()[0];
      if(!(el instanceof Element)) return;
      if(el.matches('input[type=checkbox],input[type=radio],input[type=range],input[type=file]')) return;
      if(!('value' in el) && !el.isContentEditable) return;
      flushScroll();if(pendingElement && pendingElement!==el)flushInput();pendingElement=el;
      pendingInput=packet({actionType:'Input',mode:'replace',value:String(el.value ?? el.textContent ?? ''),...targetPoint(el)});
      if(el.matches('select'))pendingInput.nativeTarget={error:'原生选项选择需要 Agent 执行。'};
      clearTimeout(inputTimer);inputTimer=setTimeout(flushInput,250);
    });
    on('compositionend', e => {if(!e.isTrusted)return;const el=e.target;if(!el)return;
      flushScroll();if(pendingElement && pendingElement!==el)flushInput();pendingElement=el;
      pendingInput=packet({actionType:'Input',mode:'replace',value:String(el.value ?? el.textContent ?? ''),...targetPoint(el)});clearTimeout(inputTimer);inputTimer=setTimeout(flushInput,250);});
    on('change', e => {if(!e.isTrusted)return;flushInput();});
    on('focusout', e => {if(e.isTrusted)flushInput();});
    on('keydown', e => {
      if(!e.isTrusted || e.isComposing || e.keyCode===229 || ['Process','Unidentified','Dead','Shift','Control','Alt','Meta','Backspace','Delete'].includes(e.key)) return;
      // Input already retains the typed case. A Caps Lock toggle inside the
      // field changes keyboard mode, not the recorded value or input boundary.
      const el=e.composedPath?.()[0] || e.target;
      if(e.key==='CapsLock' && (el?.matches?.('input,textarea') || el?.isContentEditable)) return;
      if(e.key.length===1 && !e.ctrlKey && !e.metaKey && !e.altKey) return;
      if((e.ctrlKey||e.metaKey)&&['a','c','v','x','z'].includes(e.key.toLowerCase())) return;
      flush();emit(packet({actionType:'KeyboardPress',keyName:[e.ctrlKey?'Control':null,e.metaKey?'Meta':null,e.altKey?'Alt':null,e.shiftKey?'Shift':null,e.key].filter(Boolean).join('+')}));
    });
    on('wheel', e => {if(!e.isTrusted || (!e.deltaX && !e.deltaY)) return;flushInput();
      const horizontal=Math.abs(e.deltaX)>Math.abs(e.deltaY),delta=horizontal?e.deltaX:e.deltaY;
      const next=packet({actionType:'Scroll',...point(e),direction:horizontal?(delta<0?'left':'right'):(delta<0?'up':'down'),distance:Math.abs(delta)*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1),scrollType:'singleAction'});
      if(pendingScroll && pendingScroll.payload.direction===next.payload.direction && JSON.stringify(pendingScroll.nativeTarget.locator)===JSON.stringify(next.nativeTarget.locator))pendingScroll.payload.distance+=next.payload.distance;
      else{flushScroll();pendingScroll=next;}
      clearTimeout(scrollTimer);scrollTimer=setTimeout(flushScroll,180);
    });
    on('pagehide',flush);
    window[${JSON.stringify(control)}] = async () => {flush();for(const [type,fn] of listeners)window.removeEventListener(type,fn,true);delete window[${JSON.stringify(control)}];await Promise.allSettled([...deliveries]);};
  })()`;
}
