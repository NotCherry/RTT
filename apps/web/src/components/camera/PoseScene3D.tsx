import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H3 } from "@/components/ui/typography";
import type { LandmarkFrame } from "@/types";
import type { CameraCalibration } from "@/domain/multiCameraContract";
const edges = [[11,12], [11,13], [13,15], [12,14], [14,16], [11,23], [12,24], [23,24], [23,25], [25,27], [24,26], [26,28]];
const displayPoint = (point: THREE.Vector3) => point.set(point.x, -point.y, -point.z);
function cameraFrustums(calibration: CameraCalibration) {
  const group = new THREE.Group(), reference = calibration.cameras[0];
  const refRotation = new THREE.Matrix3().set(...reference.rotation as [number,number,number,number,number,number,number,number,number]);
  const refTranslation = new THREE.Vector3(...reference.translation as [number,number,number]);
  for (const c of calibration.cameras) {
    const inverse = new THREE.Matrix3().set(...c.rotation as [number,number,number,number,number,number,number,number,number]).transpose();
    const translation = new THREE.Vector3(...c.translation as [number,number,number]);
    const transform = (p: THREE.Vector3) => displayPoint(p.sub(translation).applyMatrix3(inverse).applyMatrix3(refRotation).add(refTranslation));
    const origin = transform(new THREE.Vector3());
    const corners = [[0,0],[c.width,0],[c.width,c.height],[0,c.height]].map(([u,v]) => transform(new THREE.Vector3((u-c.intrinsic[2])/c.intrinsic[0]*.2, (v-c.intrinsic[5])/c.intrinsic[4]*.2, .2)));
    const segments = corners.flatMap((p,i) => [...origin.toArray(), ...p.toArray(), ...p.toArray(), ...corners[(i+1)%4].toArray()]);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(segments,3));
    group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x75b5ff })));
  }
  return group;
}
export function PoseScene3D({ frame, calibration }: { frame: LandmarkFrame | null; calibration?: CameraCalibration }) {
  const container = useRef<HTMLDivElement>(null), current = useRef(frame);
  current.current = frame;
  useEffect(() => {
    const host = container.current; if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); host.append(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0e13);
    const camera = new THREE.PerspectiveCamera(45, 1, .01, 100);
    camera.position.set(1.5, 1.2, 2.5);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    const grid = new THREE.GridHelper(4, 20, 0x354352, 0x25303b); scene.add(grid);
    const frustums = calibration ? cameraFrustums(calibration) : null;
    if (frustums) scene.add(frustums);
    const geometry = new THREE.BufferGeometry(); const buffer = new THREE.Float32BufferAttribute(new Float32Array(edges.length * 6), 3); geometry.setAttribute("position", buffer);
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x69d696 })); scene.add(lines);
    const resize = new ResizeObserver(() => { const width = host.clientWidth, height = host.clientHeight || 320; renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); }); resize.observe(host);
    let raf = 0, centered = false;
    function animate() {
      const points = current.current?.pose_world;
      if (frustums) frustums.visible = !current.current || current.current.multi_view?.model === "triangulated";
      const visible = (i: number) => points?.[i] && [points[i].x,points[i].y,points[i].z].every(Number.isFinite) && (points[i].visibility ?? 0) >= .5;
      const positions = edges.filter(([a,b]) => visible(a) && visible(b)).flatMap(pair => pair.flatMap(i => displayPoint(new THREE.Vector3(points![i].x,points![i].y,points![i].z)).toArray()));
      buffer.array.set(positions); buffer.needsUpdate = true; geometry.setDrawRange(0, positions.length / 3);
      geometry.computeBoundingSphere();
      if (!centered && positions.length) { const center = geometry.boundingSphere!.center; controls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(1.5,1.2,2.5)); grid.position.y = center.y - .8; centered = true; }
      controls.update(); renderer.render(scene,camera); raf = requestAnimationFrame(animate);
    }
    animate();
    return () => { cancelAnimationFrame(raf); resize.disconnect(); controls.dispose(); scene.traverse(object => { if (object instanceof THREE.Line || object instanceof THREE.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(m => m.dispose()); } }); renderer.dispose(); renderer.domElement.remove(); };
  }, [calibration]);
  return <Panel className="route-content-panel"><PanelHeader><div><PanelLabel>RECONSTRUCTED SKELETON</PanelLabel><H3>Inspect movement in 3D</H3></div></PanelHeader>
    <div ref={container} className="camera-pose-scene" role="img" aria-label="Interactive 3D human skeleton" />
    <p className="helper-text">{!frame ? "Waiting for usable landmarks" : frame.multi_view?.model === "triangulated" ? `${frame.multi_view.triangulated_landmarks} reconstructed landmarks · ${frame.multi_view.contributing_views.length} views` : "Inferred monocular depth"}. Drag to orbit. {calibration ? "Blue camera frustums appear with calibrated reconstruction." : "Calibrate to see camera placement."}</p>
  </Panel>;
}
