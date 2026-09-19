import './styles.css';
import { createSceneRig } from './three/renderer';
import { addLighting } from './three/lighting';
import { addVoidBackdrop } from './three/void';
import { Board } from './three/board';
import { showSideSelect } from './ui/sideSelect';
import { GameController } from './game/gameController';

const mount = document.getElementById('scene-root')!;
const uiRoot = document.getElementById('ui-root')!;

const rig = createSceneRig(mount);
addLighting(rig.scene);
const voidFx = addVoidBackdrop(rig.scene);

const board = new Board();
rig.scene.add(board.group);

window.addEventListener('resize', () => rig.resize());

function tick() {
  const dt = rig.clock.getDelta();
  voidFx.update(dt);
  board.update(dt);
  rig.controls.update();
  rig.renderer.render(rig.scene, rig.camera);
  requestAnimationFrame(tick);
}
tick();

async function startMatch(): Promise<void> {
  const { color, difficulty } = await showSideSelect(uiRoot);
  const controller = await GameController.start(
    { scene: rig.scene, camera: rig.camera, renderer: rig.renderer, board, uiRoot },
    color,
    difficulty,
  );
  controller.onRestart = () => void startMatch();
}

void startMatch();
