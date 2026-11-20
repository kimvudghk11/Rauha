import { contextBridge, ipcRenderer } from 'electron';
import { PET_IPC, type PetBridge, type PetView } from '../shared/desk-pet-ipc.js';

/** 바탕화면 델피 창에만 여는 좁은 다리(메인 창의 window.rauha 와 따로) */
const bridge: PetBridge = {
  sendSegment: (samples) => ipcRenderer.send(PET_IPC.segment, samples),
  hover: (on) => ipcRenderer.send(PET_IPC.hover, on === true),
  click: () => ipcRenderer.send(PET_IPC.click),
  menu: () => ipcRenderer.send(PET_IPC.menu),
  micFailed: (reason) => ipcRenderer.send(PET_IPC.micFailed, String(reason).slice(0, 300)),
  onView: (listener) => void ipcRenderer.on(PET_IPC.view, (_e, view: PetView) => listener(view)),
  onSpeak: (listener) =>
    void ipcRenderer.on(PET_IPC.speak, (_e, sound: { audio?: unknown; rate?: unknown }) => {
      if (sound?.audio instanceof Float32Array && typeof sound.rate === 'number') listener({ audio: sound.audio, rate: sound.rate });
    }),
};
contextBridge.exposeInMainWorld('pet', bridge);
