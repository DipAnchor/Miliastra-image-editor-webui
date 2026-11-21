import type { MouseEvent } from "react";
import { useI18n } from "./i18n";
import { HANDLE_POINTS, pointFromBox, type TransformBox, type HandleDirection, type Point } from "./transformGeometry";
import "./transformControls.css";

type StartHandle<T extends string> = (event: MouseEvent, operation: T, handle?: HandleDirection) => void;
type Props = { box: TransformBox } & (
  { pivot: Point; onStart: StartHandle<"resize" | "pivot">; onMaskStart?: never } |
  { pivot?: never; onStart?: never; onMaskStart: StartHandle<"move" | "resize"> }
);
export function TransformControls({ box, pivot, onStart, onMaskStart }: Props) {
  const {t}=useI18n(),center=pointFromBox(box,{x:0.5,y:0.5});
  const corners=(["nw","ne","se","sw"] as HandleDirection[]).map(key=>pointFromBox(box,HANDLE_POINTS[key]));
  return <div className="transform-controls" data-testid={onMaskStart ? "mask-transform-controls" : "transform-controls"}>
    <svg className="transform-outline" aria-hidden="true"><polygon points={corners.map(p=>p.x+","+p.y).join(" ")} /></svg>
    {(Object.keys(HANDLE_POINTS) as HandleDirection[]).map(handle=>{
      const point=pointFromBox(box,HANDLE_POINTS[handle]);
      const angle=((Math.round(Math.atan2(point.y-center.y,point.x-center.x)*4/Math.PI)%4)+4)%4;
      const cursor=["ew-resize","nwse-resize","ns-resize","nesw-resize"][angle];
      return <button key={handle} type="button" className="transform-point transform-resize-point" data-handle={handle}
        aria-label={t("transform.resize."+handle)} title={t("transform.resize."+handle)} style={{left:point.x,top:point.y,cursor}}
        onMouseDown={event => onMaskStart ? onMaskStart(event, "resize", handle) : onStart(event, "resize", handle)} />;
    })}
    {onMaskStart ?
      <button type="button" className="transform-point transform-pivot" data-handle="move" aria-label={t("luaMask.moveHandle")} title={t("luaMask.moveHandle")}
        style={{ left: center.x, top: center.y }} onMouseDown={event => onMaskStart(event, "move")}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2v16M2 10h16m-6-6-2-2-2 2m4 12-2 2-2-2M4 8l-2 2 2 2m12-4 2 2-2 2" fill="none"/></svg>
      </button>
    : <button type="button" className="transform-point transform-pivot" data-handle="pivot" aria-label={t("transform.pivot")} title={t("transform.pivot")}
      style={{left:pivot.x,top:pivot.y}} onMouseDown={event=>onStart(event,"pivot")}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4"/><path d="M10 1v5m0 8v5M1 10h5m8 0h5"/></svg>
    </button>}
  </div>;
}
