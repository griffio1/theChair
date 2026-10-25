"use client";

import {useLayoutEffect, useRef, type TextareaHTMLAttributes} from "react";
import "./compact-composer.css";

export function MessageInput(props:TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref=useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(()=>{
    const input=ref.current;
    if(!input)return;
    const resize=()=>{
      input.style.height="0px";
      const height=Math.min(160,Math.max(24,input.scrollHeight));
      input.style.height=`${height}px`;
      input.style.overflowY=input.scrollHeight>160?"auto":"hidden";
    };
    resize();
    const observer=new ResizeObserver(()=>{
      if(input.clientWidth!==width){width=input.clientWidth;resize();}
    });
    let width=input.clientWidth;
    observer.observe(input);
    return ()=>observer.disconnect();
  },[props.value]);
  return <textarea {...props} ref={ref} rows={1} />;
}
