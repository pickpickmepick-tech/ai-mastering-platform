/**
 * Real-time granular pitch shifter (time-domain, delay-line/crossfade
 * technique). Unlike AudioBufferSourceNode.detune -- which is just a
 * multiplier combined into the SAME physical playbackRate, so it can never
 * be independent of speed -- this reads two crossfading "grain" taps from a
 * short rolling history buffer at `ratio`x the write rate, so pitch can be
 * shifted with the block's duration/tempo left untouched by this node.
 *
 * Two taps, permanently 180 degrees (grainSize/2) out of phase, each on a
 * Hann-windowed delay that cycles 0..grainSize. Because the taps are always
 * exactly half a cycle apart, their windows sum to a constant 1 at every
 * sample (the standard 50%-overlap Hann identity), so the crossfade between
 * them is click-free as one fades out and the other fades in.
 */
export interface PitchShifterNode extends ScriptProcessorNode {
  setRatio: (ratio: number) => void;
}

const GRAIN_SIZE = 4096;
const HISTORY_SIZE = GRAIN_SIZE * 4;
const PROCESS_BLOCK = 2048;

export function createPitchShifter(ctx: AudioContext, channelCount = 2): PitchShifterNode {
  const history: Float32Array[] = Array.from({ length: channelCount }, () => new Float32Array(HISTORY_SIZE));
  let writePos = 0;
  let delayA = 0;
  let delayB = GRAIN_SIZE / 2;
  let ratio = 1;

  // ScriptProcessorNode is deprecated in favor of AudioWorklet, but needs no
  // extra module file to load and is still fully supported -- appropriate
  // for this preview-only feature.
  const node = ctx.createScriptProcessor(PROCESS_BLOCK, channelCount, channelCount) as PitchShifterNode;

  node.onaudioprocess = (e: AudioProcessingEvent) => {
    const blockSize = e.inputBuffer.length;
    const inputs: Float32Array[] = [];
    const outputs: Float32Array[] = [];
    for (let ch = 0; ch < channelCount; ch++) {
      inputs.push(e.inputBuffer.getChannelData(ch));
      outputs.push(e.outputBuffer.getChannelData(ch));
    }

    let w = writePos;
    let dA = delayA;
    let dB = delayB;
    const step = 1 - ratio;

    for (let i = 0; i < blockSize; i++) {
      const slot = w % HISTORY_SIZE;
      for (let ch = 0; ch < channelCount; ch++) {
        history[ch][slot] = inputs[ch][i];
      }
      w++;

      dA += step;
      if (dA < 0) dA += GRAIN_SIZE;
      if (dA >= GRAIN_SIZE) dA -= GRAIN_SIZE;
      dB += step;
      if (dB < 0) dB += GRAIN_SIZE;
      if (dB >= GRAIN_SIZE) dB -= GRAIN_SIZE;

      const winA = 0.5 - 0.5 * Math.cos((2 * Math.PI * dA) / GRAIN_SIZE);
      const winB = 0.5 - 0.5 * Math.cos((2 * Math.PI * dB) / GRAIN_SIZE);

      const readA = (w - Math.round(dA) + HISTORY_SIZE * 2) % HISTORY_SIZE;
      const readB = (w - Math.round(dB) + HISTORY_SIZE * 2) % HISTORY_SIZE;

      for (let ch = 0; ch < channelCount; ch++) {
        outputs[ch][i] = history[ch][readA] * winA + history[ch][readB] * winB;
      }
    }

    writePos = w % (HISTORY_SIZE * 1024);
    delayA = dA;
    delayB = dB;
  };

  node.setRatio = (r: number) => {
    ratio = Math.max(0.25, Math.min(4, r));
  };

  return node;
}
