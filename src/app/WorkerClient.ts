/**
 * Typed wrapper around the simulation worker. Owns the worker lifetime; routes messages to listeners.
 */
import type { ManeuverKind } from '../sim/types';
import type { VentSettings } from '../sim/vent/settings';
import type { BalloonParams } from '../sim/patient/balloon';
import type { MainToWorker, ScenarioSpec, WorkerToMain } from '../worker/protocol';
import type { DriveParams } from '../sim/patient/neural-drive';
import type { InjectorKind, InjectorParamMap } from '../sim/injectors';
import type { GasParams } from '../sim/patient/gas-exchange';

export type WorkerListener = (m: WorkerToMain) => void;

export class WorkerClient {
  private worker: Worker;
  private listeners = new Set<WorkerListener>();

  constructor() {
    this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module', name: 'ventsim' });
    this.worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
      for (const l of this.listeners) l(ev.data);
    };
    this.worker.onerror = (e) => console.error('sim worker error', e.message);
  }

  subscribe(l: WorkerListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private send(m: MainToWorker): void {
    this.worker.postMessage(m);
  }

  init(scenario: ScenarioSpec): void {
    this.send({ type: 'init', scenario });
  }
  applySettings(partial: Partial<VentSettings>): void {
    this.send({ type: 'applySettings', partial });
  }
  setBalloon(balloon: BalloonParams): void {
    this.send({ type: 'setBalloon', balloon });
  }
  maneuver(kind: ManeuverKind): void {
    this.send({ type: 'maneuver', kind });
  }
  inject<K extends InjectorKind>(kind: K, params: Partial<InjectorParamMap[K]> | null): void {
    this.send({ type: 'inject', kind, params });
  }
  setPatient(drive: Partial<DriveParams>): void {
    this.send({ type: 'setPatient', drive });
  }
  setWarp(warp: number): void {
    this.send({ type: 'setWarp', warp });
  }
  setGas(partial: Partial<GasParams>): void {
    this.send({ type: 'setGas', partial });
  }
  setPatientScale(scale: { rScale?: number; eScale?: number }): void {
    this.send({ type: 'setPatientScale', scale });
  }
  setSpeed(speed: number): void {
    this.send({ type: 'setSpeed', speed });
  }
  pause(): void {
    this.send({ type: 'pause' });
  }
  resume(): void {
    this.send({ type: 'resume' });
  }
  terminate(): void {
    this.worker.terminate();
  }
}
