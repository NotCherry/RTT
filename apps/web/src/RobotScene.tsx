import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Robot, SimulationState } from "./types";

type Props = { robot: Robot | null; state: SimulationState | null };

type MotionBinding = {
  group: THREE.Group;
  jointIndex: number;
  type: string;
  axis: THREE.Vector3;
};

function setTransform(
  object: THREE.Object3D,
  transform: { xyz: number[]; rpy: number[] },
) {
  object.position.set(
    transform.xyz[0] ?? 0,
    transform.xyz[1] ?? 0,
    transform.xyz[2] ?? 0,
  );
  object.rotation.set(
    transform.rpy[0] ?? 0,
    transform.rpy[1] ?? 0,
    transform.rpy[2] ?? 0,
  );
}

function material(color: number[]) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(
      color[0] ?? 0.28,
      color[1] ?? 0.62,
      color[2] ?? 0.91,
    ),
    roughness: 0.68,
    metalness: 0.16,
  });
}

function geometryFor(
  geometry: Robot["links"][number]["visuals"][number]["geometry"],
) {
  if (geometry.type === "box")
    return new THREE.BoxGeometry(
      ...(geometry.size as [number, number, number]),
    );
  if (geometry.type === "sphere")
    return new THREE.SphereGeometry(geometry.radius, 24, 16);
  const cylinder = new THREE.CylinderGeometry(
    geometry.radius,
    geometry.radius,
    geometry.length,
    24,
  );
  cylinder.rotateX(Math.PI / 2);
  return cylinder;
}

export function RobotScene({ robot, state }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const bindingsRef = useRef<MotionBinding[]>([]);

  useEffect(() => {
    if (!mountRef.current || !robot) return;
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#10151d");
    const camera = new THREE.PerspectiveCamera(
      38,
      mount.clientWidth / Math.max(1, mount.clientHeight),
      0.01,
      100,
    );
    camera.position.set(3.2, 2.6, 4.2);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.8, 0);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight("#dbeafe", "#172033", 2.2));
    const keyLight = new THREE.DirectionalLight("#ffffff", 3);
    keyLight.position.set(3, 5, 4);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const grid = new THREE.GridHelper(8, 24, "#324052", "#1d2938");
    scene.add(grid);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshStandardMaterial({ color: "#111923", roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    scene.add(floor);

    const links = new Map<string, THREE.Group>();
    robot.links.forEach((link) => {
      const group = new THREE.Group();
      group.name = link.name;
      link.visuals.forEach((visual) => {
        const mesh = new THREE.Mesh(
          geometryFor(visual.geometry),
          material(visual.color),
        );
        setTransform(mesh, visual.origin);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      });
      links.set(link.name, group);
    });

    const root = links.get(robot.root);
    if (root) {
      // URDF Z-up -> Three Y-up: rotate upright so arm stands vertically
      const upright = new THREE.Group();
      upright.add(root);
      upright.rotation.x = -Math.PI / 2;
      scene.add(upright);
    }
    const bindings: MotionBinding[] = [];
    robot.joints.forEach((joint) => {
      const parent = links.get(joint.parent);
      const child = links.get(joint.child);
      if (!parent || !child) return;
      const originGroup = new THREE.Group();
      setTransform(originGroup, joint.origin);
      const motionGroup = new THREE.Group();
      originGroup.add(motionGroup);
      motionGroup.add(child);
      parent.add(originGroup);
      if (joint.controllable) {
        bindings.push({
          group: motionGroup,
          jointIndex: indexOfControllable(robot, joint.name),
          type: joint.type,
          axis: new THREE.Vector3(
            ...(joint.axis as [number, number, number]),
          ).normalize(),
        });
      }
    });
    bindingsRef.current = bindings;

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    let animation = 0;
    const render = () => {
      animation = requestAnimationFrame(render);
      controls.update();
      bindingsRef.current.forEach((binding) => {
        const value = stateRef.current?.positions[binding.jointIndex] ?? 0;
        binding.group.rotation.set(0, 0, 0);
        binding.group.position.set(0, 0, 0);
        if (binding.type === "prismatic")
          binding.group.position.copy(binding.axis).multiplyScalar(value);
        else binding.group.setRotationFromAxisAngle(binding.axis, value);
      });
      renderer.render(scene, camera);
    };
    render();
    return () => {
      cancelAnimationFrame(animation);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material))
            object.material.forEach((item) => item.dispose());
          else object.material.dispose();
        }
      });
      mount.removeChild(renderer.domElement);
    };
  }, [robot]);

  const stateRef = useRef<SimulationState | null>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  return (
    <div className="scene-shell">
      {!robot && (
        <div className="scene-empty">
          <span className="scene-empty-icon">◎</span>
          <strong>Load a robot to begin</strong>
          <span>Choose a Unitree G1 example or upload a primitive URDF.</span>
        </div>
      )}
      <div ref={mountRef} className="scene-mount" />
      {robot && (
        <div className="scene-hud">
          <span className="status-dot" /> Physics preview{" "}
          <span className="hud-divider">·</span> {robot.links.length} links
        </div>
      )}
    </div>
  );
}

function indexOfControllable(robot: Robot, name: string) {
  return robot.joints
    .filter((joint) => joint.controllable)
    .findIndex((joint) => joint.name === name);
}
