// Procedural Web Audio soundscape & subtle generative background music for GitVillage
import type { TimeOfDay } from '@/types/village';

interface ChordVoicing {
  pad: number[]; // MIDI notes for warm pad
  scale: number[]; // MIDI notes for delicate kalimba / celesta plucks
}

const DAY_PROGRESSION: ChordVoicing[] = [
  { pad: [50, 57, 61, 66], scale: [69, 73, 74, 76, 78, 81, 85] }, // Dmaj9
  { pad: [47, 54, 59, 62], scale: [66, 69, 71, 74, 76, 78, 81] }, // Bm7(add11)
  { pad: [43, 50, 54, 59], scale: [66, 67, 71, 74, 76, 79, 81] }, // Gmaj9
  { pad: [45, 52, 57, 61], scale: [66, 69, 71, 73, 76, 81, 83] }, // A6/9
];

const SUNSET_PROGRESSION: ChordVoicing[] = [
  { pad: [43, 50, 54, 59], scale: [64, 66, 71, 74, 76, 78] }, // Gmaj9
  { pad: [42, 49, 54, 57], scale: [64, 66, 69, 73, 76, 78] }, // F#m7
  { pad: [40, 47, 52, 55], scale: [64, 66, 67, 71, 74, 76] }, // Em9
  { pad: [45, 52, 55, 59], scale: [64, 66, 69, 71, 74, 76] }, // A9sus4
];

const NIGHT_PROGRESSION: ChordVoicing[] = [
  { pad: [47, 54, 57, 62], scale: [74, 76, 78, 81, 85, 86] }, // Bm9
  { pad: [43, 50, 54, 57], scale: [74, 76, 78, 81, 83, 86] }, // Gmaj7(6)
  { pad: [50, 57, 61, 64], scale: [73, 76, 78, 81, 85, 88] }, // Dmaj9/A
  { pad: [45, 52, 54, 59], scale: [73, 76, 78, 80, 83, 85] }, // Asus2(add6)
];

const STORM_PROGRESSION: ChordVoicing[] = [
  { pad: [40, 47, 52, 55], scale: [64, 67, 71, 74, 76, 79] }, // Em9
  { pad: [36, 43, 48, 55], scale: [64, 67, 72, 74, 76, 79] }, // Cmaj7(9)
  { pad: [45, 52, 55, 60], scale: [64, 67, 69, 72, 76, 79] }, // Am9
  { pad: [47, 54, 57, 62], scale: [66, 69, 71, 74, 76, 78] }, // Bm7
];

function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

class CozySoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;
  private lastBumpAt = 0;

  // Ambient music bus & scheduler state
  private musicMasterGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private musicDryBus: GainNode | null = null;
  private musicEchoSend: GainNode | null = null;
  private schedulerId: number | null = null;
  private nextStepTime = 0;
  private stepIndex = 0;
  private barIndex = 0;
  private mood: TimeOfDay = 'day';
  private musicEnabled = false;
  private listenersBound = false;
  private cleanupListeners: (() => void) | null = null;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.setupMusicGraph(this.ctx);
    }
    if (this.ctx.state === 'suspended' && !document.hidden) {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private setupMusicGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(this.getFilterCutoffForMood(this.mood), ctx.currentTime);
    filter.Q.setValueAtTime(0.55, ctx.currentTime);

    const dry = ctx.createGain();
    dry.gain.setValueAtTime(0.85, ctx.currentTime);

    // Subtle stereo ping-pong echo wash for airy floating-island atmosphere
    const echoSend = ctx.createGain();
    echoSend.gain.setValueAtTime(0.32, ctx.currentTime);

    const delayL = ctx.createDelay(1.5);
    const delayR = ctx.createDelay(1.5);
    delayL.delayTime.setValueAtTime(0.39, ctx.currentTime);
    delayR.delayTime.setValueAtTime(0.58, ctx.currentTime);

    const fbL = ctx.createGain();
    const fbR = ctx.createGain();
    fbL.gain.setValueAtTime(0.26, ctx.currentTime);
    fbR.gain.setValueAtTime(0.24, ctx.currentTime);

    const echoFilter = ctx.createBiquadFilter();
    echoFilter.type = 'lowpass';
    echoFilter.frequency.setValueAtTime(1650, ctx.currentTime);

    const panL = ctx.createStereoPanner?.();
    const panR = ctx.createStereoPanner?.();
    if (panL && panR) {
      panL.pan.setValueAtTime(-0.48, ctx.currentTime);
      panR.pan.setValueAtTime(0.48, ctx.currentTime);
      delayL.connect(panL).connect(filter);
      delayR.connect(panR).connect(filter);
    } else {
      delayL.connect(filter);
      delayR.connect(filter);
    }

    echoSend.connect(echoFilter);
    echoFilter.connect(delayL);
    delayL.connect(fbL).connect(delayR);
    delayR.connect(fbR).connect(delayL);

    dry.connect(filter);
    filter.connect(master);
    master.connect(ctx.destination);

    this.musicMasterGain = master;
    this.musicFilter = filter;
    this.musicDryBus = dry;
    this.musicEchoSend = echoSend;
  }

  private getFilterCutoffForMood(mood: TimeOfDay): number {
    if (mood === 'storm') return 940;
    if (mood === 'sunset') return 1180;
    if (mood === 'night') return 1480;
    return 1750;
  }

  private getTargetMusicGain(): number {
    if (this.muted || !this.musicEnabled) return 0.0001;
    // Ultra-subtle ambient level so it gently cushions the village without overpowering chimes
    if (this.mood === 'storm') return 0.12;
    if (this.mood === 'night') return 0.115;
    if (this.mood === 'sunset') return 0.125;
    return 0.135;
  }

  private rampMusicGain(durationSec = 1.6): void {
    if (!this.ctx || !this.musicMasterGain) return;
    const now = this.ctx.currentTime;
    const gainParam = this.musicMasterGain.gain;
    gainParam.cancelScheduledValues(now);
    gainParam.setValueAtTime(Math.max(0.0001, gainParam.value), now);
    gainParam.linearRampToValueAtTime(this.getTargetMusicGain(), now + durationSec);
  }

  public initAmbientMusic(): void {
    this.musicEnabled = true;
    // Attempt immediate gentle start if browser already permits audio
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'running') {
      this.ensureSchedulerRunning();
      this.rampMusicGain(2.4);
    }

    if (this.listenersBound) return;
    this.listenersBound = true;

    const unlockOnGesture = () => {
      if (this.muted || !this.musicEnabled) return;
      const c = this.ensureContext();
      if (!c) return;
      c.resume()
        .then(() => {
          if (!this.muted && this.musicEnabled) {
            this.ensureSchedulerRunning();
            this.rampMusicGain(2.2);
          }
        })
        .catch(() => {});
    };

    const onVisibilityChange = () => {
      if (!this.ctx) return;
      if (document.hidden) {
        this.ctx.suspend().catch(() => {});
      } else if (!this.muted && this.musicEnabled) {
        this.ctx
          .resume()
          .then(() => {
            this.nextStepTime = Math.max(this.nextStepTime, this.ctx!.currentTime + 0.08);
            this.rampMusicGain(1.2);
          })
          .catch(() => {});
      }
    };

    window.addEventListener('pointerdown', unlockOnGesture, { passive: true });
    window.addEventListener('keydown', unlockOnGesture, { passive: true });
    window.addEventListener('wheel', unlockOnGesture, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);

    this.cleanupListeners = () => {
      window.removeEventListener('pointerdown', unlockOnGesture);
      window.removeEventListener('keydown', unlockOnGesture);
      window.removeEventListener('wheel', unlockOnGesture);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      this.listenersBound = false;
    };
  }

  public stopAmbientMusic(): void {
    this.musicEnabled = false;
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    this.cleanupListeners?.();
    this.cleanupListeners = null;
    if (this.ctx && this.musicMasterGain) {
      this.rampMusicGain(0.25);
    }
  }

  public setMood(mood: TimeOfDay): void {
    this.mood = mood;
    if (this.ctx && this.musicFilter) {
      const now = this.ctx.currentTime;
      this.musicFilter.frequency.cancelScheduledValues(now);
      this.musicFilter.frequency.setValueAtTime(this.musicFilter.frequency.value, now);
      this.musicFilter.frequency.exponentialRampToValueAtTime(
        this.getFilterCutoffForMood(mood),
        now + 1.4,
      );
      this.rampMusicGain(1.4);
    }
  }

  private ensureSchedulerRunning(): void {
    if (this.schedulerId !== null || !this.ctx) return;
    this.nextStepTime = this.ctx.currentTime + 0.12;
    this.schedulerId = window.setInterval(() => this.scheduleLookahead(), 180);
  }

  private scheduleLookahead(): void {
    if (!this.ctx || this.ctx.state !== 'running' || this.muted || !this.musicEnabled) return;

    const stepDur =
      this.mood === 'storm'
        ? 0.68
        : this.mood === 'night'
          ? 0.72
          : this.mood === 'sunset'
            ? 0.64
            : 0.56;
    const lookaheadHorizon = this.ctx.currentTime + 0.48;

    while (this.nextStepTime < lookaheadHorizon) {
      this.scheduleMusicalStep(this.nextStepTime, stepDur);
      this.nextStepTime += stepDur;
      this.stepIndex = (this.stepIndex + 1) % 8;
      if (this.stepIndex === 0) {
        this.barIndex = (this.barIndex + 1) % 4;
      }
    }
  }

  private scheduleMusicalStep(when: number, stepDur: number): void {
    if (!this.ctx || !this.musicDryBus || !this.musicEchoSend) return;

    const progression =
      this.mood === 'storm'
        ? STORM_PROGRESSION
        : this.mood === 'night'
          ? NIGHT_PROGRESSION
          : this.mood === 'sunset'
            ? SUNSET_PROGRESSION
            : DAY_PROGRESSION;
    const chord = progression[this.barIndex % progression.length];

    // On beat 0 of every bar (8-step bar), swell a warm felt/pad chord
    if (this.stepIndex === 0) {
      const barDur = stepDur * 8;
      this.scheduleWarmPadChord(when, barDur, chord.pad);
    }

    // Gentle sparse kalimba / celesta notes with natural breathing room
    const playChance =
      this.stepIndex === 0
        ? 0.55
        : this.stepIndex === 4
          ? 0.65
          : this.stepIndex % 2 === 1
            ? 0.34
            : 0.48;

    if (Math.random() < playChance) {
      const scale = chord.scale;
      const pickIdx =
        (this.barIndex * 2 + this.stepIndex + Math.floor(Math.random() * 3)) % scale.length;
      const midi = scale[pickIdx];
      const pan = ((this.stepIndex % 4) - 1.5) * 0.22;
      this.scheduleDelicatePluck(when, midi, pan);

      // Occasional soft fifth/third grace harmony on beat 4
      if (this.stepIndex === 4 && Math.random() < 0.35) {
        const harmMidi = scale[(pickIdx + 2) % scale.length];
        this.scheduleDelicatePluck(when + stepDur * 0.5, harmMidi, -pan * 0.8, 0.68);
      }
    }
  }

  private scheduleWarmPadChord(when: number, dur: number, notes: number[]): void {
    const ctx = this.ctx;
    const dry = this.musicDryBus;
    const echo = this.musicEchoSend;
    if (!ctx || !dry || !echo) return;

    notes.forEach((midi, idx) => {
      const baseFreq = midiToFreq(midi);
      // Slight chorus detune pair on inner voices for analog warmth
      const detunes = idx === 0 ? [0] : [-4.5, 4.5];
      for (const cents of detunes) {
        const osc = ctx.createOscillator();
        const voiceGain = ctx.createGain();
        osc.type = idx === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(baseFreq * 2 ** (cents / 1200), when);

        const peak = (idx === 0 ? 0.055 : 0.026) / detunes.length;
        const attack = Math.min(1.5, dur * 0.34);
        const release = 1.9;

        voiceGain.gain.setValueAtTime(0.0001, when);
        voiceGain.gain.linearRampToValueAtTime(peak, when + attack);
        voiceGain.gain.setValueAtTime(peak * 0.88, when + dur * 0.72);
        voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + dur + release);

        osc.connect(voiceGain);
        voiceGain.connect(dry);
        if (idx > 0) {
          voiceGain.connect(echo);
        }

        osc.start(when);
        osc.stop(when + dur + release + 0.05);
      }
    });
  }

  private scheduleDelicatePluck(
    when: number,
    midi: number,
    panValue = 0,
    velScale = 1,
  ): void {
    const ctx = this.ctx;
    const dry = this.musicDryBus;
    const echo = this.musicEchoSend;
    if (!ctx || !dry || !echo) return;

    const freq = midiToFreq(midi);
    const isNight = this.mood === 'night';

    // Fundamental + soft bell overtone that decays quickly like a wooden kalimba / celesta tine
    const oscFund = ctx.createOscillator();
    const oscHarm = ctx.createOscillator();
    const fundGain = ctx.createGain();
    const harmGain = ctx.createGain();

    oscFund.type = isNight ? 'sine' : 'triangle';
    oscFund.frequency.setValueAtTime(freq, when);

    oscHarm.type = 'sine';
    oscHarm.frequency.setValueAtTime(freq * (isNight ? 3.0 : 2.0), when);

    const amp = 0.042 * velScale;
    const decay = isNight ? 2.1 : 1.45;

    fundGain.gain.setValueAtTime(0.0001, when);
    fundGain.gain.linearRampToValueAtTime(amp, when + 0.014);
    fundGain.gain.exponentialRampToValueAtTime(0.0001, when + decay);

    harmGain.gain.setValueAtTime(0.0001, when);
    harmGain.gain.linearRampToValueAtTime(amp * 0.28, when + 0.008);
    harmGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);

    const panner = ctx.createStereoPanner?.();
    if (panner) {
      panner.pan.setValueAtTime(Math.max(-0.8, Math.min(0.8, panValue)), when);
      fundGain.connect(panner);
      harmGain.connect(panner);
      panner.connect(dry);
      panner.connect(echo);
    } else {
      fundGain.connect(dry);
      harmGain.connect(dry);
      fundGain.connect(echo);
    }

    oscFund.connect(fundGain);
    oscHarm.connect(harmGain);

    oscFund.start(when);
    oscHarm.start(when);
    oscFund.stop(when + decay + 0.05);
    oscHarm.stop(when + 0.34);
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) {
      this.rampMusicGain(0.28);
    } else {
      const ctx = this.ensureContext();
      if (ctx) {
        this.ensureSchedulerRunning();
        this.rampMusicGain(1.1);
      }
      this.playPop(523.25);
    }
    return this.muted;
  }

  public playHover(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.045);
    gain.gain.setValueAtTime(0.025, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  public playPop(freq = 440): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.35, now + 0.09);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playBump(): void {
    const perfNow = performance.now();
    if (perfNow - this.lastBumpAt < 420) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.lastBumpAt = perfNow;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(195, now);
    osc.frequency.exponentialRampToValueAtTime(118, now + 0.065);
    gain.gain.setValueAtTime(0.022, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  public playSelectVillager(kind: string): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const scales: Record<string, number[]> = {
      feat: [523.25, 659.25, 783.99, 1046.5],
      fix: [440, 554.37, 659.25],
      merge: [392, 493.88, 587.33, 783.99, 987.77],
      docs: [493.88, 587.33, 739.99],
      refactor: [587.33, 659.25, 880],
      chore: [392, 523.25, 659.25],
    };
    const notes = scales[kind] ?? scales.chore;
    notes.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === notes.length - 1 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.065, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    });
  }

  public playRepoLoaded(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const chord = [261.63, 329.63, 392.0, 523.25, 659.25];
    chord.forEach((freq, i) => {
      const now = ctx.currentTime + i * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.48);
    });
  }

  public playParachuteDeploy(stepIdx = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Gentle airy silk canopy pop + upward whistle
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const base = 370 + (stepIdx % 5) * 28;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 1.48, now + 0.075);
    gain.gain.setValueAtTime(0.022, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  public playCelebrationChime(stepIdx = 0, kind = 'feat'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    // Sparkling D-major9 / Lydian celesta celebration ladder
    const ladder = [587.33, 659.25, 739.99, 880.0, 987.77, 1108.73, 1174.66, 1318.51];
    const rootIdx = stepIdx % 5;
    const notes =
      kind === 'merge'
        ? [587.33, 739.99, 880.0, 1174.66, 1479.98]
        : [ladder[rootIdx], ladder[rootIdx + 1], ladder[rootIdx + 3]];

    const panner = ctx.createStereoPanner?.();
    if (panner) {
      panner.pan.setValueAtTime(((stepIdx % 5) - 2) * 0.22, ctx.currentTime);
      panner.connect(ctx.destination);
    }
    const out: AudioNode = panner ?? ctx.destination;

    notes.forEach((freq, idx) => {
      const when = ctx.currentTime + idx * 0.048;
      const fund = ctx.createOscillator();
      const bell = ctx.createOscillator();
      const fGain = ctx.createGain();
      const bGain = ctx.createGain();

      fund.type = 'triangle';
      fund.frequency.setValueAtTime(freq, when);

      bell.type = 'sine';
      bell.frequency.setValueAtTime(freq * 2.0, when);

      const peak = idx === notes.length - 1 ? 0.058 : 0.044;
      fGain.gain.setValueAtTime(0.0001, when);
      fGain.gain.linearRampToValueAtTime(peak, when + 0.008);
      fGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.34);

      bGain.gain.setValueAtTime(0.0001, when);
      bGain.gain.linearRampToValueAtTime(peak * 0.35, when + 0.005);
      bGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);

      fund.connect(fGain).connect(out);
      bell.connect(bGain).connect(out);
      fund.start(when);
      bell.start(when);
      fund.stop(when + 0.36);
      bell.stop(when + 0.18);
    });
  }
}

export const sound = new CozySoundEngine();
