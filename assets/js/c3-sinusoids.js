// extraction.js
'use strict';

// A sample's nonzero grade must remain stable until reset. For that contract,
// start + retained-position mask uniquely identifies the full key (including
// length, since its final position is retained). Missing observations may vary.
class StructuralExtractor {
  constructor() {
    this.seen = new Uint32Array(12 * 128); // 4096 mask bits per live start.
    this.positions = new Float64Array(12);
    this.knownPositions = new Float64Array(12);
    this.knownGrades = new Uint8Array(12);
    this.tokens = new Uint8Array(12);
    this.debugStarts = new Float64Array(200);
    this.debugLengths = new Uint8Array(200);
    this.debugTokens = new Uint8Array(200 * 12);
    this.debugAccepted = new Uint8Array(200);
    this.reset();
  }

  reset() {
    this.seen.fill(0);
    this.positions.fill(-1);
    this.knownPositions.fill(-1);
    this.knownGrades.fill(0);
    this.lastStart = -1;
    this.generated = this.accepted = this.suppressed = this.debugCount = 0;
    this.rejectedSpans = 0;
  }

  copyFrom(source) {
    this.seen.set(source.seen);
    this.positions.set(source.positions);
    this.knownPositions.set(source.knownPositions);
    this.knownGrades.set(source.knownGrades);
    this.tokens.set(source.tokens);
    this.debugStarts.set(source.debugStarts);
    this.debugLengths.set(source.debugLengths);
    this.debugTokens.set(source.debugTokens);
    this.debugAccepted.set(source.debugAccepted);
    this.lastStart = source.lastStart;
    this.generated = source.generated;
    this.accepted = source.accepted;
    this.suppressed = source.suppressed;
    this.debugCount = source.debugCount;
    this.rejectedSpans = source.rejectedSpans;
  }

  process(observed, start, minimum, sink = null, size = observed.length) {
    if (!Number.isSafeInteger(start) || start < this.lastStart || start < 0 ||
        !Number.isSafeInteger(start + size) || !Number.isInteger(size) || size < 3 || size > 12 || size > observed.length ||
        !Number.isInteger(minimum) || minimum < 3 || minimum > size) {
      throw new RangeError('Expected a forward window of 3–12 positions and a valid minimum length.');
    }
    // Validate before mutation, including overlapping readings. Zero means an
    // omission, never a replacement for a previously known grade.
    for (let i = 0; i < size; i++) {
      const token = observed[i], position = start + i, slot = position % 12;
      if (!Number.isInteger(token) || token < 0 || token > 32) throw new RangeError('Invalid grade.');
      if (token && this.knownPositions[slot] === position && this.knownGrades[slot] &&
          this.knownGrades[slot] !== token) throw new Error('Sample grade changed; reset extraction first.');
    }
    for (let slot = 0; slot < 12; slot++) {
      if (this.positions[slot] < start) {
        this.seen.fill(0, slot * 128, (slot + 1) * 128);
        this.positions[slot] = -1;
      }
    }
    for (let i = 0; i < size; i++) {
      const position = start + i, slot = position % 12;
      if (this.knownPositions[slot] !== position) {
        this.knownPositions[slot] = position;
        this.knownGrades[slot] = 0;
      }
      if (observed[i]) this.knownGrades[slot] = observed[i];
    }
    this.lastStart = start;
    this.generated = this.accepted = this.suppressed = this.debugCount = this.rejectedSpans = 0;
    for (let length = minimum; length <= size; length++) {
      for (let offset = 0; offset <= size - length; offset++) {
        if (!observed[offset] || !observed[offset + length - 1]) { this.rejectedSpans++; continue; }
        const position = start + offset, slot = position % 12;
        if (this.positions[slot] !== position) {
          this.seen.fill(0, slot * 128, (slot + 1) * 128);
          this.positions[slot] = position;
        }
        for (let mask = (1 << (length - 2)) - 1; mask >= 0; mask--) {
          let retained = 1 | (1 << (length - 1));
          this.tokens[0] = observed[offset];
          this.tokens[length - 1] = observed[offset + length - 1];
          for (let i = 1; i < length - 1; i++) {
            const token = (mask & (1 << (i - 1))) ? observed[offset + i] : 0;
            this.tokens[i] = token;
            if (token) retained |= 1 << i;
          }
          const word = slot * 128 + (retained >>> 5), bit = 1 << (retained & 31);
          const accepted = !(this.seen[word] & bit);
          this.seen[word] |= bit;
          this.generated++;
          if (accepted) this.accepted++; else this.suppressed++;
          if (this.debugCount < 200) {
            const row = this.debugCount++;
            this.debugStarts[row] = position;
            this.debugLengths[row] = length;
            this.debugAccepted[row] = accepted ? 1 : 0;
            for (let i = 0; i < length; i++) this.debugTokens[row * 12 + i] = this.tokens[i];
          }
          if (accepted && sink && !sink.add(this.tokens, length)) return false;
        }
      }
    }
    return this;
  }

  debugText() {
    const alphabet = '-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
    const lines = [];
    for (let row = 0; row < this.debugCount; row++) {
      let key = '';
      for (let i = 0; i < this.debugLengths[row]; i++) key += alphabet[this.debugTokens[row * 12 + i]];
      lines.push(`${this.debugStarts[row]}\t${key}\t${this.debugAccepted[row] ? 'accepted' : 'suppressed duplicate'}`);
    }
    return lines.join('\n');
  }
}




// accumulation.js
'use strict';

const COUNT_MAX = 0xffffffff;
const RL_MIN = -0x80000000, RL_MAX = 0x7fffffff;
const STORE_OK = 0, STORE_CAPACITY = 1, STORE_OVERFLOW = 2, STORE_BATCH_CAPACITY = 3;
function clampRl(value) { return Math.max(RL_MIN, Math.min(RL_MAX, value)); }

function comparePacked(a, ai, b, bi, words) {
  for (let word = 0; word < words; word++) {
    const av = a[ai + word] >>> 0, bv = b[bi + word] >>> 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

class PatternCodec {
  constructor(grades) {
    if (!Number.isInteger(grades) || grades < 2 || grades > 32) throw new RangeError('Grades must be 2–32.');
    this.grades = grades;
    this.bits = Math.ceil(Math.log2(grades + 1));
    this.perWord = Math.floor(32 / this.bits);
    this.base = 2 ** this.bits;
  }

  wordsFor(length) { return Math.ceil(length / this.perWord); }

  pack(tokens, length, output, offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 3 || length > 12 || tokens.length < offset + length ||
        !(output instanceof Uint32Array) || output.length < this.wordsFor(length)) throw new RangeError('Invalid packed-key dimensions.');
    for (let i = 0; i < length; i++) {
      if (!Number.isInteger(tokens[offset + i]) || tokens[offset + i] < 0 || tokens[offset + i] > this.grades) throw new RangeError('Invalid token ID.');
    }
    let word = 0, value = 0;
    for (let i = 0; i < length; i++) {
      // No symbol straddles words. Each chunk (including the last) is right
      // aligned. Accumulation never exceeds 32 bits, hence is exact in Number.
      value = value * this.base + tokens[offset + i];
      if ((i + 1) % this.perWord === 0 || i === length - 1) {
        output[word++] = value;
        value = 0;
      }
    }
    return output;
  }

  unpack(packed, length, output) {
    if (!Number.isInteger(length) || length < 3 || length > 12 || output.length < length || packed.length < this.wordsFor(length)) throw new RangeError('Invalid unpack dimensions.');
    for (let word = 0; word < this.wordsFor(length); word++) {
      const start = word * this.perWord, end = Math.min(length, start + this.perWord);
      let value = packed[word] >>> 0;
      for (let i = end - 1; i >= start; i--) { output[i] = value % this.base; value = Math.floor(value / this.base); }
    }
    return output;
  }
}

// Internal fixed-width storage. Callers supply valid packed keys and slot IDs.
// A level contains unique keys; duplicate contributions are added by add().
class SortedPatternLevel {
  constructor(capacity, words, slots, rlSlots = 0) {
    if (![capacity, words, slots].every(value => Number.isSafeInteger(value) && value > 0)) throw new RangeError('Invalid level dimensions.');
    if (!Number.isInteger(rlSlots) || rlSlots < 0 || rlSlots > slots) throw new RangeError('Invalid RL slot count.');
    this.capacity = capacity;
    this.words = words;
    this.slots = slots;
    this.rlSlots = rlSlots;
    this.keys = new Uint32Array(capacity * words);
    this.counts = new Uint32Array(capacity * slots);
    this.rl = new Int32Array(capacity * rlSlots);
    this.size = 0;
  }

  lowerBound(key, offset = 0) {
    let low = 0, high = this.size;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (comparePacked(this.keys, mid * this.words, key, offset, this.words) < 0) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  find(key, offset = 0) {
    const index = this.lowerBound(key, offset);
    return index < this.size && comparePacked(this.keys, index * this.words, key, offset, this.words) === 0 ? index : -1;
  }

  add(key, slot, amount) {
    const index = this.lowerBound(key);
    if (index < this.size && comparePacked(this.keys, index * this.words, key, 0, this.words) === 0) {
      const at = index * this.slots + slot;
      if (this.counts[at] > COUNT_MAX - amount) return STORE_OVERFLOW;
      this.counts[at] += amount;
      return STORE_OK;
    }
    if (this.size === this.capacity) return STORE_CAPACITY;
    this.keys.copyWithin((index + 1) * this.words, index * this.words, this.size * this.words);
    this.counts.copyWithin((index + 1) * this.slots, index * this.slots, this.size * this.slots);
    this.rl.copyWithin((index + 1) * this.rlSlots, index * this.rlSlots, this.size * this.rlSlots);
    for (let i = 0; i < this.words; i++) this.keys[index * this.words + i] = key[i];
    this.counts.fill(0, index * this.slots, (index + 1) * this.slots);
    this.rl.fill(0, index * this.rlSlots, (index + 1) * this.rlSlots);
    this.counts[index * this.slots + slot] = amount;
    this.size++;
    return STORE_OK;
  }

  preflightMerge(target) {
    if (target === this || target.words !== this.words || target.slots !== this.slots || target.rlSlots !== this.rlSlots) throw new RangeError('Incompatible merge destination.');
    let source = 0, destination = 0, unique = target.size;
    while (source < this.size) {
      const order = destination === target.size ? -1 : comparePacked(this.keys, source * this.words, target.keys, destination * this.words, this.words);
      if (order > 0) { destination++; continue; }
      if (order === 0) {
        for (let slot = 0; slot < this.slots; slot++) {
          if (this.counts[source * this.slots + slot] > COUNT_MAX - target.counts[destination * this.slots + slot]) return STORE_OVERFLOW;
        }
        destination++;
      } else unique++;
      source++;
    }
    return unique <= target.capacity ? STORE_OK : STORE_CAPACITY;
  }

  mergeInto(target) {
    const status = this.preflightMerge(target);
    if (status === STORE_OK) this.mergePreflighted(target);
    return status;
  }

  // Internal commit primitive: call only after complete transaction preflight.
  // Fold existing keys first, compact only NEW source rows, then merge backward.
  // Thus the destination needs union-size capacity, not source+destination size.
  mergePreflighted(target) {
    let destination = 0, fresh = 0;
    for (let source = 0; source < this.size; source++) {
      while (destination < target.size && comparePacked(target.keys, destination * this.words, this.keys, source * this.words, this.words) < 0) destination++;
      if (destination < target.size && comparePacked(target.keys, destination * this.words, this.keys, source * this.words, this.words) === 0) {
        for (let slot = 0; slot < this.slots; slot++) target.counts[destination * this.slots + slot] += this.counts[source * this.slots + slot];
        for (let slot = 0; slot < this.rlSlots; slot++) target.rl[destination * this.rlSlots + slot] =
          clampRl(target.rl[destination * this.rlSlots + slot] + this.rl[source * this.rlSlots + slot]);
      } else {
        for (let word = 0; word < this.words; word++) this.keys[fresh * this.words + word] = this.keys[source * this.words + word];
        for (let slot = 0; slot < this.slots; slot++) this.counts[fresh * this.slots + slot] = this.counts[source * this.slots + slot];
        for (let slot = 0; slot < this.rlSlots; slot++) this.rl[fresh * this.rlSlots + slot] = this.rl[source * this.rlSlots + slot];
        fresh++;
      }
    }
    const mergedSize = target.size + fresh;
    let source = fresh - 1, old = target.size - 1, write = mergedSize - 1;
    while (source >= 0) {
      const takeSource = old < 0 || comparePacked(this.keys, source * this.words, target.keys, old * this.words, this.words) > 0;
      const input = takeSource ? this : target, read = takeSource ? source-- : old--;
      for (let word = 0; word < this.words; word++) target.keys[write * this.words + word] = input.keys[read * this.words + word];
      for (let slot = 0; slot < this.slots; slot++) target.counts[write * this.slots + slot] = input.counts[read * this.slots + slot];
      for (let slot = 0; slot < this.rlSlots; slot++) target.rl[write * this.rlSlots + slot] = input.rl[read * this.rlSlots + slot];
      write--;
    }
    target.size = mergedSize;
    this.size = 0;
  }
}

class PatternAccumulator {
  static plan(options = {}) {
    const grades = options.grades ?? 8, minimum = options.minimum ?? 3, maximum = options.maximum ?? 12;
    const slots = options.slots ?? 12, rlSlots = options.rlSlots ?? 0, budgetBytes = options.budgetBytes ?? 16 * 1024 * 1024;
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 3 || maximum > 12 || minimum > maximum ||
        !Number.isInteger(slots) || slots < 1 || slots > 13 || !Number.isInteger(rlSlots) || rlSlots < 0 || rlSlots > Math.min(slots, 12) ||
        !Number.isSafeInteger(budgetBytes) || budgetBytes < 1) throw new RangeError('Invalid storage configuration.');
    const codec = new PatternCodec(grades), banks = [];
    let keyBytes = 0, countBytes = 0, rlBytes = 0, stagingBytes = 0;
    for (let length = minimum; length <= maximum; length++) {
      const scale = 2 ** Math.floor((length - 3) / 2);
      const capacities = options.capacities?.[length] ?? [Math.min(1024, 128 * scale), 512 * scale, 2048 * scale];
      if (capacities.length !== 3 || !capacities.every(value => Number.isSafeInteger(value) && value > 0 && value <= 10000000)) throw new RangeError('Each bank needs three positive capacities (at most 10 million each).');
      if (capacities[0] > capacities[1] || capacities[1] > capacities[2]) throw new RangeError('Cascade capacities must not decrease upward.');
      const words = codec.wordsFor(length), staged = (maximum - length + 1) * 2 ** (length - 2);
      const records = capacities[0] + capacities[1] + capacities[2];
      const keys = records * words * 4, counts = records * slots * 4, rewards = (records + staged) * rlSlots * 4;
      const staging = staged * (words + slots) * 4;
      keyBytes += keys; countBytes += counts; rlBytes += rewards; stagingBytes += staging;
      banks.push({ length, words, capacities: Array.from(capacities), staged, keyBytes: keys, countBytes: counts, rlBytes: rewards, stagingBytes: staging });
    }
    const workspaceBytes = codec.wordsFor(maximum) * 4 + 4 * 4 + banks.length + slots * 4;
    // Include every training slot + TEST and the reusable working extractor.
    // LiveExperiment allocates these buffers alongside the storage subtotal.
    const decompositionBytes = (options.streamCount ?? (slots + 1)) * 10772;
    const checkpointBytes = 10760;
    const liveWorkspaceBytes = 24; // Candidate input and omission permutation.
    // PatternSimilarity has slot-wide and training-wide work arrays, three
    // cursors, a 64-voter heap, and 13 complexity-layer rows for recruitment.
    const comparisonBytes = options.streamCount ?
      (slots * 2 + (slots - 1) * 4 + 64 * slots + 13 * slots) * 8 +
      (3 + 64 + 13) * 4 + 64 + (64 + 4072) * 3 * 4 + 11 * 4 + (slots - 1) * 8 : 0;
    const storageBytes = keyBytes + countBytes + rlBytes + stagingBytes + workspaceBytes;
    const totalBytes = storageBytes + decompositionBytes + checkpointBytes + liveWorkspaceBytes + comparisonBytes;
    if (totalBytes > budgetBytes) throw new RangeError(`Planned typed arrays require ${totalBytes} bytes; budget is ${budgetBytes}.`);
    return { grades, minimum, maximum, slots, rlSlots, budgetBytes, banks, keyBytes, countBytes, rlBytes, stagingBytes, workspaceBytes, decompositionBytes, checkpointBytes, liveWorkspaceBytes, comparisonBytes, storageBytes, totalBytes };
  }

  constructor(options = {}) {
    this.plan = PatternAccumulator.plan(options); // Validate the whole budget BEFORE allocating.
    this.codec = new PatternCodec(this.plan.grades);
    this.banks = this.plan.banks.map(bank => ({
      length: bank.length,
      words: bank.words,
      // Index 0 is the stride batch. Indices 1–3 are persistent L1–L3.
      levels: [new SortedPatternLevel(bank.staged, bank.words, this.plan.slots, this.plan.rlSlots),
        ...bank.capacities.map(capacity => new SortedPatternLevel(capacity, bank.words, this.plan.slots, this.plan.rlSlots))]
    }));
    this.key = new Uint32Array(this.codec.wordsFor(this.plan.maximum));
    this.cursors = new Uint32Array(4);
    this.targets = new Uint8Array(this.banks.length);
    this.distinct = new Uint32Array(this.plan.slots);
    this.batchLimit = this.plan.banks.reduce((sum, bank) => sum + bank.staged, 0);
    this.reset();
  }

  reset() {
    for (let bank = 0; bank < this.banks.length; bank++) {
      for (let level = 0; level < 4; level++) this.banks[bank].levels[level].size = 0;
    }
    this.active = false;
    this.stopped = false;
    this.failureCode = STORE_OK;
    this.failureLength = 0;
    this.contributions = 0;
    this.distinct.fill(0);
  }

  begin(slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.plan.slots) throw new RangeError('Invalid training slot.');
    if (this.stopped) return false;
    if (this.active) throw new Error('Finish or cancel the active stride first.');
    for (let bank = 0; bank < this.banks.length; bank++) this.banks[bank].levels[0].size = 0;
    this.slot = slot;
    this.contributions = 0;
    this.active = true;
    return true;
  }

  fail(code, length) {
    this.stopped = true;
    this.failureCode = code;
    this.failureLength = length;
    return false;
  }

  add(tokens, length = tokens.length, amount = 1) {
    if (this.stopped) return false;
    if (!this.active) throw new Error('Begin a stride before adding contributions.');
    if (!Number.isInteger(length) || length < this.plan.minimum || length > this.plan.maximum ||
        !Number.isInteger(amount) || amount < 1 || amount > COUNT_MAX || !tokens[0] || !tokens[length - 1]) throw new RangeError('Invalid pattern contribution.');
    this.codec.pack(tokens, length, this.key);
    const index = length - this.plan.minimum;
    // The preallocated batch is bounded by the exhaustive candidates in ONE
    // window. Accepting more calls would violate that workspace contract.
    if (this.contributions >= this.batchLimit) return this.fail(STORE_BATCH_CAPACITY, length);
    const status = this.banks[index].levels[0].add(this.key, this.slot, amount);
    if (status !== STORE_OK) return this.fail(status === STORE_CAPACITY ? STORE_BATCH_CAPACITY : status, length);
    this.contributions++;
    return true;
  }

  // Sorted union traversal uses four fixed cursors, regardless of bank sizes.
  unionSize(bank, levels, firstLevel = 0) {
    this.cursors.fill(0);
    let unique = 0;
    while (true) {
      let first = -1;
      for (let level = firstLevel; level < levels; level++) {
        const input = bank.levels[level];
        if (this.cursors[level] >= input.size) continue;
        if (first < 0 || comparePacked(input.keys, this.cursors[level] * input.words,
            bank.levels[first].keys, this.cursors[first] * input.words, input.words) < 0) first = level;
      }
      if (first < 0) return unique;
      const selected = bank.levels[first], keyAt = this.cursors[first] * selected.words;
      // Advance the selected cursor LAST so its key remains stable throughout.
      for (let level = firstLevel; level < levels; level++) {
        if (level === first) continue;
        const input = bank.levels[level], at = this.cursors[level];
        if (at < input.size && comparePacked(input.keys, at * input.words, selected.keys, keyAt, input.words) === 0) this.cursors[level]++;
      }
      this.cursors[first]++;
      unique++;
    }
  }

  countsFit(bank) {
    const batch = bank.levels[0];
    // Unchanged committed keys already satisfy the invariant. Only batch keys
    // need lookup, avoiding a scan of the entire largest bank every stride.
    for (let row = 0; row < batch.size; row++) {
      for (let level = 1; level <= 3; level++) {
        this.cursors[level] = bank.levels[level].find(batch.keys, row * batch.words) + 1;
      }
      for (let slot = 0; slot < this.plan.slots; slot++) {
        const added = batch.counts[row * batch.slots + slot];
        let total = added;
        for (let level = 1; level <= 3; level++) {
          if (this.cursors[level]) total += bank.levels[level].counts[(this.cursors[level] - 1) * batch.slots + slot];
        }
        if (total > COUNT_MAX) return false;
        if (slot === this.slot && added > 0 && total === added) this.pendingDistinct++;
      }
    }
    return true;
  }

  commit() {
    if (this.stopped) return false;
    if (!this.active) throw new Error('No active stride.');
    this.pendingDistinct = 0;
    // Preflight EVERY affected length before mutating ANY committed level.
    for (let index = 0; index < this.banks.length; index++) {
      const bank = this.banks[index];
      this.targets[index] = 0;
      if (!bank.levels[0].size) continue;
      if (!this.countsFit(bank)) return this.fail(STORE_OVERFLOW, bank.length);
      const levels = bank.levels;
      if (this.unionSize(bank, 2) <= levels[1].capacity) this.targets[index] = 1;
      else if (levels[0].size <= levels[1].capacity) {
        // Normal cascade: make room upward BEFORE moving L1, then put this
        // stride in the emptied L1. A full L3 need not stop lower-level updates.
        if (this.unionSize(bank, 3, 1) <= levels[2].capacity) this.targets[index] = 2;
        else if (this.unionSize(bank, 4, 2) <= levels[3].capacity) this.targets[index] = 3;
      } else {
        // Custom tiny L1 banks may be smaller than a complete stride. Promote
        // that batch together with lower levels into the first fitting bank.
        if (this.unionSize(bank, 3) <= levels[2].capacity) this.targets[index] = 4;
        else if (this.unionSize(bank, 4) <= levels[3].capacity) this.targets[index] = 5;
      }
      if (!this.targets[index]) return this.fail(STORE_CAPACITY, bank.length);
    }
    // No callbacks, allocations, asynchronous work, or fallible capacity checks
    // in this phase. Each intermediate union is a subset of the checked union.
    for (let index = 0; index < this.banks.length; index++) {
      const action = this.targets[index];
      if (!action) continue;
      const levels = this.banks[index].levels;
      if (action === 3) levels[2].mergePreflighted(levels[3]);
      if (action === 2 || action === 3) levels[1].mergePreflighted(levels[2]);
      if (action <= 3) levels[0].mergePreflighted(levels[1]);
      else {
        const target = action - 2;
        for (let source = target - 1; source >= 0; source--) levels[source].mergePreflighted(levels[target]);
      }
    }
    this.distinct[this.slot] += this.pendingDistinct;
    this.active = false;
    return true;
  }

  clearSlot(slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.plan.slots) throw new RangeError('Invalid training slot.');
    if (this.active || this.stopped) throw new Error('Reset the experiment before changing a stopped or unfinished batch.');
    for (let bank = 0; bank < this.banks.length; bank++) {
      for (let levelIndex = 1; levelIndex <= 3; levelIndex++) {
        const level = this.banks[bank].levels[levelIndex];
        let write = 0;
        for (let row = 0; row < level.size; row++) {
          level.counts[row * level.slots + slot] = 0;
          if (slot < level.rlSlots) level.rl[row * level.rlSlots + slot] = 0;
          let occupied = false;
          for (let other = 0; other < level.slots; other++) if (level.counts[row * level.slots + other]) occupied = true;
          if (!occupied) continue;
          if (write !== row) {
            for (let word = 0; word < level.words; word++) level.keys[write * level.words + word] = level.keys[row * level.words + word];
            for (let other = 0; other < level.slots; other++) level.counts[write * level.slots + other] = level.counts[row * level.slots + other];
            for (let other = 0; other < level.rlSlots; other++) level.rl[write * level.rlSlots + other] = level.rl[row * level.rlSlots + other];
          }
          write++;
        }
        level.size = write;
      }
    }
    this.distinct[slot] = 0;
  }

  count(tokens, length, slot, offset = 0) {
    if (!Number.isInteger(length) || length < this.plan.minimum || length > this.plan.maximum ||
        !Number.isInteger(slot) || slot < 0 || slot >= this.plan.slots) throw new RangeError('Invalid count readout.');
    this.codec.pack(tokens, length, this.key, offset);
    const levels = this.banks[length - this.plan.minimum].levels;
    let total = 0;
    for (let level = 1; level <= 3; level++) {
      const input = levels[level], at = input.find(this.key);
      if (at >= 0) total += input.counts[at * input.slots + slot];
    }
    return total;
  }

  // RL is separate from occurrence counts. Reward the highest persistent copy
  // containing this class; duplicate physical keys are summed on read/merge.
  reinforcePacked(bank, key, offset, slot, delta) {
    if (this.active || this.stopped) throw new Error('RL feedback requires committed, writable storage.');
    if (!this.plan.rlSlots || !Number.isInteger(slot) || slot < 0 || slot >= this.plan.rlSlots ||
        (delta !== 1 && delta !== -1)) return false;
    for (let level = 3; level >= 1; level--) {
      const input = bank.levels[level], row = input.find(key, offset);
      if (row < 0 || !input.counts[row * input.slots + slot]) continue;
      const at = row * input.rlSlots + slot;
      input.rl[at] = clampRl(input.rl[at] + delta);
      return true;
    }
    return false;
  }

  readRlPacked(bank, key, offset, output) {
    output.fill(0);
    if (!this.plan.rlSlots) return output;
    for (let level = 1; level <= 3; level++) {
      const input = bank.levels[level], row = input.find(key, offset);
      if (row < 0) continue;
      for (let slot = 0; slot < input.rlSlots; slot++) output[slot] += input.rl[row * input.rlSlots + slot];
    }
    return output;
  }

  reinforce(tokens, length, slot, delta) {
    if (length < this.plan.minimum || length > this.plan.maximum) throw new RangeError('Invalid RL pattern length.');
    this.codec.pack(tokens, length, this.key);
    return this.reinforcePacked(this.banks[length - this.plan.minimum], this.key, 0, slot, delta);
  }

  cancel() {
    if (this.stopped) return false; // Preserve the failed batch for inspection.
    for (let bank = 0; bank < this.banks.length; bank++) this.banks[bank].levels[0].size = 0;
    this.active = false;
    return true;
  }

  read(tokens, output, length = tokens.length) {
    if (!Number.isInteger(length) || length < this.plan.minimum || length > this.plan.maximum ||
        !(output instanceof Uint32Array) || output.length < this.plan.slots) throw new RangeError('Invalid count readout.');
    this.codec.pack(tokens, length, this.key);
    output.fill(0);
    const levels = this.banks[length - this.plan.minimum].levels;
    for (let level = 1; level <= 3; level++) {
      const input = levels[level], at = input.find(this.key);
      if (at >= 0) for (let slot = 0; slot < this.plan.slots; slot++) output[slot] += input.counts[at * input.slots + slot];
    }
    return output;
  }
}




// comparison.js
'use strict';

// Each measure reads the same TEST and training counts for each distinct key:
// - overlap: count keys present in both TEST and a class; ignore frequency.
// - affinity: compare relative count histograms within each pattern length
//   (Bhattacharyya affinity), then average the lengths with TEST evidence.
// - weightedProduct / "pseudo-cosine": sum length * TEST count * class count
//   over shared keys. This raw product has no cosine normalization.
// - contrastProduct: use observed-token count instead of length and multiply
//   by how far the key's class-relative frequencies are from an even split.
// - silhouette: weighted histogram distance over the full key union, turned
//   into a 0–100% similarity and averaged over lengths with TEST evidence.
// - selective: let only the strongest 64 shared TEST keys at each length vote;
//   rank by contrast, observed tokens, TEST repetition, and training support.
// - selectiveRl: same shortlist and weights, but bounded signed feedback
//   adjusts each key's class vote shares after prior labeled TEST windows.
// - layered: use that same shortlist, starting with more observed tokens and
//   recruiting simpler layers until the leading class has a decisive margin.
// Measure A and Measure B can select any two of these without changing storage.
const CONTRAST_SCALE = 1000000n; // Six decimal places for BigInt contrast scores.
const SILHOUETTE_MIN_CONTRAST = 200000n; // 0.20; only silhouette uses this gate.
const SELECTIVE_KEYS_PER_LENGTH = 64;
const RL_HALF_STRENGTH = 8;
// Feedback targets an explicitly selected visible training row.
let rlCorrectSlot = 0;
let feedbackEnabled = false;
const LAYERED_MIN_VOTERS = 12;
const LAYERED_STOP_MARGIN = 0.25;
const SIMILARITY_MEASURES = Object.freeze({
  overlap: { label: 'Matching distinct patterns' },
  affinity: { label: 'Frequency affinity by length' },
  weightedProduct: { label: 'Pseudo-cosine (raw count product)' },
  contrastProduct: { label: 'Extended pseudo-cosine (contrast)' },
  silhouette: { label: 'Silhouette-inspired similarity' },
  selective: { label: 'Selective evidence vote (64/length)' },
  selectiveRl: { label: 'Selective evidence vote + RL' },
  layered: { label: 'Layered evidence recruitment' }
});

class PatternSimilarity {
  constructor(trainingSlots, testSlot) {
    this.trainingSlots = trainingSlots;
    this.testSlot = testSlot;
    this.overlapScores = Array(trainingSlots).fill(0);
    this.affinityScores = Array(trainingSlots).fill(0);
    this.productScores = Array(trainingSlots).fill(0n);
    this.contrastScores = Array(trainingSlots).fill(0n);
    this.silhouetteScores = Array(trainingSlots).fill(0);
    this.selectiveScores = Array(trainingSlots).fill(0);
    this.selectiveRlScores = Array(trainingSlots).fill(0);
    this.layeredScores = Array(trainingSlots).fill(0);
    this.scores = this.overlapScores;
    this.secondaryScores = this.affinityScores;
    this.measure = 'overlap';
    this.secondaryMeasure = 'affinity';
    this.ready = false;
    this.dirty = true;
    this.totals = new Float64Array(testSlot + 1);
    this.cursors = new Uint32Array(3);
    this.classMass = new Float64Array(testSlot + 1);
    this.affinity = new Float64Array(trainingSlots);
    this.contrastMass = Array(testSlot + 1).fill(0n);
    this.relative = new Float64Array(trainingSlots);
    this.distance = new Float64Array(trainingSlots);
    this.distanceMass = new Float64Array(trainingSlots);
    this.voterWeights = new Float64Array(SELECTIVE_KEYS_PER_LENGTH);
    this.voterHashes = new Uint32Array(SELECTIVE_KEYS_PER_LENGTH);
    this.voterKeys = new Uint32Array(SELECTIVE_KEYS_PER_LENGTH * 3);
    this.voterComplexities = new Uint8Array(SELECTIVE_KEYS_PER_LENGTH);
    this.voterShares = new Float64Array(SELECTIVE_KEYS_PER_LENGTH * trainingSlots);
    // Snapshot only accepted keys from the newly committed TEST batch. The
    // cascade reuses its batch rows during commit, so feedback needs this copy.
    this.feedbackKeys = new Uint32Array(4072 * 3);
    this.feedbackOffsets = new Uint32Array(11);
    this.rlReadout = new Float64Array(trainingSlots);
    this.feedbackPending = false;
    this.rlRewards = 0;
    this.rlPenalties = 0;
    this.layerWeights = new Float64Array(13);
    this.layerCounts = new Uint32Array(13);
    this.layerShares = new Float64Array(13 * trainingSlots);
    this.voterCount = 0;
    this.selectedVoters = 0;
    this.layeredVotersUsed = 0;
    this.layeredLayersUsed = 0;
    this.layeredStoppedEarly = false;
    this.silhouetteConsideredKeys = 0;
    this.silhouetteRetainedKeys = 0;
  }

  invalidate() { this.dirty = true; }

  select(measure, panel = 0) {
    if (!SIMILARITY_MEASURES[measure]) throw new RangeError('Unknown similarity measure.');
    if (panel !== 0 && panel !== 1) throw new RangeError('Unknown comparison panel.');
    if (panel === 0) this.measure = measure;
    else this.secondaryMeasure = measure;
    this.invalidate();
  }

  scoresFor(measure) {
    return measure === 'affinity' ? this.affinityScores : measure === 'weightedProduct' ? this.productScores :
      measure === 'contrastProduct' ? this.contrastScores : measure === 'silhouette' ? this.silhouetteScores :
      measure === 'selective' ? this.selectiveScores : measure === 'selectiveRl' ? this.selectiveRlScores :
      measure === 'layered' ? this.layeredScores : this.overlapScores;
  }

  captureFeedback(storage) {
    this.feedbackPending = false;
    if (storage.plan.rlSlots <= rlCorrectSlot) return;
    let count = 0;
    for (let bankIndex = 0; bankIndex < storage.banks.length; bankIndex++) {
      const batch = storage.banks[bankIndex].levels[0];
      this.feedbackOffsets[bankIndex] = count;
      for (let row = 0; row < batch.size; row++) {
        if (count >= 4072) throw new RangeError('TEST feedback batch exceeds the 12-position window bound.');
        for (let word = 0; word < batch.words; word++) this.feedbackKeys[count * 3 + word] = batch.keys[row * batch.words + word];
        count++;
      }
    }
    this.feedbackOffsets[storage.banks.length] = count;
    this.feedbackPending = true;
  }

  discardFeedback() { this.feedbackPending = false; }
  resetFeedback() { this.discardFeedback(); this.rlRewards = this.rlPenalties = 0; }

  feedbackContains(bankIndex, key, offset, words) {
    let low = this.feedbackOffsets[bankIndex], high = this.feedbackOffsets[bankIndex + 1];
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (comparePacked(this.feedbackKeys, mid * 3, key, offset, words) < 0) low = mid + 1;
      else high = mid;
    }
    return low < this.feedbackOffsets[bankIndex + 1] &&
      comparePacked(this.feedbackKeys, low * 3, key, offset, words) === 0;
  }

  rewardSelected(storage, bank, bankIndex) {
    if (!this.feedbackPending || !this.contrastMass[rlCorrectSlot]) return;
    for (let voter = 0; voter < this.voterCount; voter++) {
      if (!this.feedbackContains(bankIndex, this.voterKeys, voter * 3, bank.words)) continue;
      let winner = -1, best = 0, tied = false;
      for (let slot = 0; slot < this.trainingSlots; slot++) {
        const share = this.voterShares[voter * this.trainingSlots + slot];
        if (share > best) { winner = slot; best = share; tied = false; }
        else if (share && share === best) tied = true;
      }
      if (winner < 0 || tied) continue;
      const correct = winner === rlCorrectSlot;
      if (storage.reinforcePacked(bank, this.voterKeys, voter * 3, winner, correct ? 1 : -1)) {
        if (correct) this.rlRewards++; else this.rlPenalties++;
      }
    }
  }

  // The user's original "naive cosine": a raw length-weighted dot product.
  // Keep it independent of future normalized or contrast-filtered variants.
  scoreWeightedProductKey(length, testCount, totals) {
    if (!testCount) return;
    const weightedTest = BigInt(length) * BigInt(testCount);
    for (let slot = 0; slot < this.trainingSlots; slot++) {
      if (totals[slot]) this.productScores[slot] += weightedTest * BigInt(totals[slot]);
    }
  }

  // C = sum(|p_i - 1/N|) / (2 * (1 - 1/N)), where p_i is this key's
  // class-relative frequency divided by the sum across trained classes.
  // Exact equality gets zero; with only one trained class, keep full weight.
  contrastWeight(totals) {
    let reference = -1;
    let classes = 0, sum = 0;
    for (let slot = 0; slot < this.trainingSlots; slot++) {
      if (!this.contrastMass[slot]) { this.relative[slot] = 0; continue; }
      classes++;
      if (reference < 0) reference = slot;
      this.relative[slot] = totals[slot] / Number(this.contrastMass[slot]);
      sum += this.relative[slot];
    }
    if (!sum || classes === 0) return 0n;
    if (classes === 1) return CONTRAST_SCALE;
    let equal = true, distance = 0;
    const uniform = 1 / classes;
    for (let slot = 0; slot < this.trainingSlots; slot++) {
      if (!this.contrastMass[slot]) continue;
      if (slot !== reference && BigInt(totals[slot]) * this.contrastMass[reference] !==
          BigInt(totals[reference]) * this.contrastMass[slot]) equal = false;
      distance += Math.abs(this.relative[slot] / sum - uniform);
    }
    if (equal) return 0n;
    return BigInt(Math.round(Math.min(1, distance / (2 * (1 - uniform))) * Number(CONTRAST_SCALE)));
  }

  observedCount(bank, selected, at, storage) {
    let observed = 0;
    const codec = storage.codec;
    for (let word = 0; word < selected.words; word++) {
      let packed = selected.keys[at + word] >>> 0;
      const symbols = Math.min(codec.perWord, bank.length - word * codec.perWord);
      for (let i = 0; i < symbols; i++) {
        if (packed % codec.base) observed++;
        packed = Math.floor(packed / codec.base);
      }
    }
    return observed;
  }

  scoreContrastProductKey(bank, selected, at, testCount, totals, storage) {
    if (!testCount) return;
    const contrast = this.contrastWeight(totals);
    if (!contrast) return;
    const observed = this.observedCount(bank, selected, at, storage);
    const weightedTest = contrast * BigInt(observed) * BigInt(testCount);
    for (let slot = 0; slot < this.trainingSlots; slot++) {
      if (totals[slot]) this.contrastScores[slot] += weightedTest * BigInt(totals[slot]);
    }
  }

  scoreSilhouetteKey(bank, selected, at, totals, storage) {
    if (!this.contrastMass[this.testSlot]) return;
    this.silhouetteConsideredKeys++;
    const contrastUnits = this.contrastWeight(totals);
    if (contrastUnits < SILHOUETTE_MIN_CONTRAST) return;
    this.silhouetteRetainedKeys++;
    const contrast = Number(contrastUnits) / Number(CONTRAST_SCALE);
    const weight = contrast * this.observedCount(bank, selected, at, storage);
    const test = Number(this.contrastMass[this.testSlot]) ? totals[this.testSlot] / Number(this.contrastMass[this.testSlot]) : 0;
    for (let slot = 0; slot < this.trainingSlots; slot++) {
      const train = this.contrastMass[slot] ? totals[slot] / Number(this.contrastMass[slot]) : 0;
      this.distance[slot] += weight * Math.abs(test - train);
      this.distanceMass[slot] += weight * (test + train);
    }
  }

  swapVoters(a, b) {
    const weight = this.voterWeights[a];
    this.voterWeights[a] = this.voterWeights[b];
    this.voterWeights[b] = weight;
    const hash = this.voterHashes[a];
    this.voterHashes[a] = this.voterHashes[b];
    this.voterHashes[b] = hash;
    for (let word = 0; word < 3; word++) {
      const packed = this.voterKeys[a * 3 + word];
      this.voterKeys[a * 3 + word] = this.voterKeys[b * 3 + word];
      this.voterKeys[b * 3 + word] = packed;
    }
    const complexity = this.voterComplexities[a];
    this.voterComplexities[a] = this.voterComplexities[b];
    this.voterComplexities[b] = complexity;
    for (let slot = 0; slot < this.trainingSlots; slot++) {
      const ai = a * this.trainingSlots + slot, bi = b * this.trainingSlots + slot;
      const share = this.voterShares[ai];
      this.voterShares[ai] = this.voterShares[bi];
      this.voterShares[bi] = share;
    }
  }

  voterLess(a, b) {
    return this.voterWeights[a] < this.voterWeights[b] ||
      (this.voterWeights[a] === this.voterWeights[b] && this.voterHashes[a] < this.voterHashes[b]);
  }

  setVoter(index, weight, hash, complexity, relativeTotal, keys, at, words) {
    this.voterWeights[index] = weight;
    this.voterHashes[index] = hash;
    this.voterComplexities[index] = complexity;
    for (let word = 0; word < words; word++) this.voterKeys[index * 3 + word] = keys[at + word];
    for (let slot = 0; slot < this.trainingSlots; slot++) {
      this.voterShares[index * this.trainingSlots + slot] = this.relative[slot] / relativeTotal;
    }
  }

  // A fixed-size min-heap keeps the 64 strongest keys without storing a
  // second dictionary or sorting all shared keys.
  offerVoter(weight, hash, complexity, relativeTotal, keys, at, words) {
    let index;
    if (this.voterCount < SELECTIVE_KEYS_PER_LENGTH) {
      index = this.voterCount++;
      this.setVoter(index, weight, hash, complexity, relativeTotal, keys, at, words);
      while (index > 0) {
        const parent = (index - 1) >>> 1;
        if (!this.voterLess(index, parent)) break;
        this.swapVoters(index, parent);
        index = parent;
      }
    } else if (weight > this.voterWeights[0] ||
        (weight === this.voterWeights[0] && hash > this.voterHashes[0])) {
      this.setVoter(0, weight, hash, complexity, relativeTotal, keys, at, words);
      index = 0;
      while (true) {
        const left = index * 2 + 1;
        if (left >= this.voterCount) break;
        const right = left + 1;
        const child = right < this.voterCount && this.voterLess(right, left) ? right : left;
        if (!this.voterLess(child, index)) break;
        this.swapVoters(index, child);
        index = child;
      }
    }
  }

  scoreSelectiveKey(bank, selected, at, totals, storage) {
    const testCount = totals[this.testSlot];
    if (!testCount) return;
    const contrast = Number(this.contrastWeight(totals)) / Number(CONTRAST_SCALE);
    if (!contrast) return;
    let support = 0, relativeTotal = 0;
    for (let slot = 0; slot < this.trainingSlots; slot++) {
      support += totals[slot];
      relativeTotal += this.relative[slot];
    }
    if (!support || !relativeTotal) return;
    // Shrink one-off training keys, but allow them to vote early in training.
    const reliability = support / (support + 8);
    const complexity = this.observedCount(bank, selected, at, storage);
    const weight = contrast * complexity *
      Math.log1p(testCount) * reliability;
    // Stable tie-breaking avoids preferring the first packed keys when many
    // early-training patterns have identical ranking weights.
    let hash = 2166136261;
    for (let word = 0; word < selected.words; word++) {
      hash = Math.imul(hash ^ selected.keys[at + word], 16777619) >>> 0;
    }
    this.offerVoter(weight, hash, complexity, relativeTotal, selected.keys, at, selected.words);
  }

  // Recruit layers from most to least observed tokens. A thin layer receives
  // less influence until 12 independent selected keys support it.
  finishLayeredScores() {
    let influenceTotal = 0;
    for (let complexity = 12; complexity >= 2; complexity--) {
      const count = this.layerCounts[complexity];
      if (!count) continue;
      this.layeredLayersUsed++;
      this.layeredVotersUsed += count;
      const influence = complexity * complexity * Math.min(1, count / LAYERED_MIN_VOTERS);
      influenceTotal += influence;
      let leader = 0, runner = 0;
      for (let slot = 0; slot < this.trainingSlots; slot++) {
        const layerShare = this.layerShares[complexity * this.trainingSlots + slot] / this.layerWeights[complexity];
        this.layeredScores[slot] += influence * layerShare;
        const score = this.layeredScores[slot] / influenceTotal;
        if (score > leader) { runner = leader; leader = score; }
        else if (score > runner) runner = score;
      }
      this.layeredMargin = leader - runner;
      if (this.layeredVotersUsed >= LAYERED_MIN_VOTERS && this.layeredMargin >= LAYERED_STOP_MARGIN) {
        for (let lower = 2; lower < complexity; lower++) {
          if (this.layerCounts[lower]) { this.layeredStoppedEarly = true; break; }
        }
        break;
      }
    }
    if (influenceTotal) for (let slot = 0; slot < this.trainingSlots; slot++) {
      this.layeredScores[slot] = 100 * this.layeredScores[slot] / influenceTotal;
    }
  }

  // Relative frequencies need each class's complete mass at this length
  // before the main scoring traversal can decide whether a key has contrast.
  collectContrastMass(bank) {
    this.contrastMass.fill(0n);
    const levels = bank.levels, cursors = this.cursors;
    cursors.fill(0);
    while (true) {
      let first = -1;
      for (let i = 0; i < 3; i++) {
        const level = levels[i + 1];
        if (cursors[i] >= level.size) continue;
        if (first < 0 || comparePacked(level.keys, cursors[i] * level.words,
            levels[first + 1].keys, cursors[first] * level.words, level.words) < 0) first = i;
      }
      if (first < 0) return;
      const selected = levels[first + 1], at = cursors[first] * selected.words;
      for (let i = 0; i < 3; i++) {
        const level = levels[i + 1], row = cursors[i];
        if (row >= level.size || comparePacked(level.keys, row * level.words, selected.keys, at, level.words) !== 0) continue;
        for (let slot = 0; slot <= this.testSlot; slot++) {
          this.contrastMass[slot] += BigInt(level.counts[row * level.slots + slot]);
        }
        cursors[i]++;
      }
    }
  }

  // Visit the sorted union of the three persistent levels at each length.
  // A key can occur in multiple levels, so sum its counts before scoring it.
  compute(storage) {
    if (!this.dirty) return this.scores;
    const overlap = this.measure === 'overlap' || this.secondaryMeasure === 'overlap';
    const frequency = this.measure === 'affinity' || this.secondaryMeasure === 'affinity';
    const product = this.measure === 'weightedProduct' || this.secondaryMeasure === 'weightedProduct';
    const contrast = this.measure === 'contrastProduct' || this.secondaryMeasure === 'contrastProduct';
    const silhouette = this.measure === 'silhouette' || this.secondaryMeasure === 'silhouette';
    const selective = this.measure === 'selective' || this.secondaryMeasure === 'selective';
    const selectiveRl = this.measure === 'selectiveRl' || this.secondaryMeasure === 'selectiveRl';
    const layered = this.measure === 'layered' || this.secondaryMeasure === 'layered';
    const voters = selective || selectiveRl || layered || this.feedbackPending;
    this.overlapScores.fill(0);
    this.affinityScores.fill(0);
    this.productScores.fill(0n);
    this.contrastScores.fill(0n);
    this.silhouetteScores.fill(0);
    this.selectiveScores.fill(0);
    this.selectiveRlScores.fill(0);
    this.layeredScores.fill(0);
    this.selectedVoters = 0;
    this.layeredVotersUsed = 0;
    this.layeredLayersUsed = 0;
    this.layeredMargin = 0;
    this.layeredStoppedEarly = false;
    if (layered) { this.layerWeights.fill(0); this.layerCounts.fill(0); this.layerShares.fill(0); }
    this.silhouetteConsideredKeys = 0;
    this.silhouetteRetainedKeys = 0;
    this.scores = this.scoresFor(this.measure);
    this.secondaryScores = this.scoresFor(this.secondaryMeasure);
    this.ready = storage.distinct[this.testSlot] > 0;
    if (!this.ready) { this.discardFeedback(); this.dirty = false; return this.scores; }
    const totals = this.totals, cursors = this.cursors;
    let testLengths = 0, silhouetteLengths = 0, selectiveLengths = 0;
    for (let bankIndex = 0; bankIndex < storage.banks.length; bankIndex++) {
      const bank = storage.banks[bankIndex];
      const levels = bank.levels;
      if (contrast || silhouette || voters) this.collectContrastMass(bank);
      cursors.fill(0);
      if (frequency) { this.classMass.fill(0); this.affinity.fill(0); }
      if (silhouette) { this.distance.fill(0); this.distanceMass.fill(0); }
      if (voters) this.voterCount = 0;
      while (true) {
        // Each committed level is sorted. Select the smallest unread key so
        // all three levels can be traversed as one logical dictionary.
        let first = -1;
        for (let i = 0; i < 3; i++) {
          const level = levels[i + 1];
          if (cursors[i] >= level.size) continue;
          if (first < 0 || comparePacked(level.keys, cursors[i] * level.words,
              levels[first + 1].keys, cursors[first] * level.words, level.words) < 0) first = i;
        }
        if (first < 0) break;
        const selected = levels[first + 1], at = cursors[first] * selected.words;
        // The same key may live in multiple levels. Combine its counts by
        // slot before any measure sees it; the last slot belongs to TEST.
        totals.fill(0);
        for (let i = 0; i < 3; i++) {
          const level = levels[i + 1], row = cursors[i];
          if (row >= level.size || comparePacked(level.keys, row * level.words, selected.keys, at, level.words) !== 0) continue;
          for (let slot = 0; slot <= this.testSlot; slot++) totals[slot] += level.counts[row * level.slots + slot];
          cursors[i]++;
        }
        const testCount = totals[this.testSlot];
        // Scoring crossroads: every selected method reads this key's totals.
        // Affinity needs all keys for its denominator, even unshared keys.
        if (frequency) for (let slot = 0; slot <= this.testSlot; slot++) this.classMass[slot] += totals[slot];
        // The raw product scores only keys found in TEST and a class.
        if (product) this.scoreWeightedProductKey(bank.length, testCount, totals);
        // The extended variant requires class contrast and weights actual readings.
        if (contrast) this.scoreContrastProductKey(bank, selected, at, testCount, totals, storage);
        if (silhouette) this.scoreSilhouetteKey(bank, selected, at, totals, storage);
        if (voters) this.scoreSelectiveKey(bank, selected, at, totals, storage);
        // These shared-key terms need both TEST and the class to contain it.
        if (testCount) for (let slot = 0; slot < this.trainingSlots; slot++) {
          if (totals[slot]) {
            if (frequency) this.affinity[slot] += Math.sqrt(totals[slot] * testCount);
            if (overlap) this.overlapScores[slot]++;
          }
        }
      }
      // Finish affinity for this length using the full histogram masses.
      if (frequency && this.classMass[this.testSlot] > 0) {
        testLengths++;
        for (let slot = 0; slot < this.trainingSlots; slot++) {
          if (this.classMass[slot] > 0) this.affinityScores[slot] += this.affinity[slot] /
            Math.sqrt(this.classMass[slot] * this.classMass[this.testSlot]);
        }
      }
      if (silhouette && this.contrastMass[this.testSlot] > 0n) {
        // A length with no eligible weighted keys contributes no score.
        if (this.distanceMass.some(value => value > 0)) silhouetteLengths++;
        for (let slot = 0; slot < this.trainingSlots; slot++) {
          if (this.distanceMass[slot] > 0) this.silhouetteScores[slot] +=
            Math.max(0, 1 - this.distance[slot] / this.distanceMass[slot]);
        }
      }
      if (voters && this.voterCount) {
        this.selectedVoters += this.voterCount;
        if (selective || selectiveRl) {
          selectiveLengths++;
          let weightTotal = 0;
          for (let voter = 0; voter < this.voterCount; voter++) weightTotal += this.voterWeights[voter];
          if (selective) for (let slot = 0; slot < this.trainingSlots; slot++) {
            let share = 0;
            for (let voter = 0; voter < this.voterCount; voter++) {
              share += this.voterWeights[voter] * this.voterShares[voter * this.trainingSlots + slot];
            }
            this.selectiveScores[slot] += share / weightTotal;
          }
          if (selectiveRl) for (let voter = 0; voter < this.voterCount; voter++) {
            storage.readRlPacked(bank, this.voterKeys, voter * 3, this.rlReadout);
            let adjustedTotal = 0;
            for (let slot = 0; slot < this.trainingSlots; slot++) {
              const rl = this.rlReadout[slot];
              adjustedTotal += this.voterShares[voter * this.trainingSlots + slot] *
                (1 + rl / (Math.abs(rl) + RL_HALF_STRENGTH));
            }
            for (let slot = 0; slot < this.trainingSlots; slot++) {
              const rl = this.rlReadout[slot];
              const adjusted = this.voterShares[voter * this.trainingSlots + slot] *
                (1 + rl / (Math.abs(rl) + RL_HALF_STRENGTH));
              this.selectiveRlScores[slot] += this.voterWeights[voter] / weightTotal * adjusted / adjustedTotal;
            }
          }
        }
        if (layered) {
          for (let voter = 0; voter < this.voterCount; voter++) {
            const complexity = this.voterComplexities[voter];
            const weight = this.voterWeights[voter];
            this.layerCounts[complexity]++;
            this.layerWeights[complexity] += weight;
            for (let slot = 0; slot < this.trainingSlots; slot++) {
              this.layerShares[complexity * this.trainingSlots + slot] +=
                weight * this.voterShares[voter * this.trainingSlots + slot];
            }
          }
        }
        // The displayed scores for this window use RL from earlier windows.
        // Feedback from newly accepted keys is applied only after both scores.
        this.rewardSelected(storage, bank, bankIndex);
      }
    }
    this.discardFeedback();
    // Give each length with TEST evidence equal weight; show affinity as 0–100%.
    if (frequency && testLengths) for (let slot = 0; slot < this.trainingSlots; slot++) {
      this.affinityScores[slot] = Math.min(100, 100 * this.affinityScores[slot] / testLengths);
    }
    if (silhouetteLengths) for (let slot = 0; slot < this.trainingSlots; slot++) {
      this.silhouetteScores[slot] = Math.min(100, 100 * this.silhouetteScores[slot] / silhouetteLengths);
    }
    if (selectiveLengths) for (let slot = 0; slot < this.trainingSlots; slot++) {
      this.selectiveScores[slot] = 100 * this.selectiveScores[slot] / selectiveLengths;
      this.selectiveRlScores[slot] = 100 * this.selectiveRlScores[slot] / selectiveLengths;
    }
    if (layered) this.finishLayeredScores();
    this.dirty = false;
    return this.scores;
  }
}





// live-experiment.js
'use strict';

// Owns the storage and all preallocated stream/checkpoint buffers. UI parameters
// live on the stream objects, but a failed candidate never replaces their state.
class LiveExperiment {
  constructor(settings, options = {}) {
    this.storageOptions = options;
    this.storage = new PatternAccumulator({ ...options, grades: settings.grades, minimum: settings.minimum, maximum: settings.window, slots: 13, streamCount: 13 });
    this.pool = Array.from({ length: 13 }, (_, index) => ({
      slot: index - 1, isTest: index === 0, extractor: new StructuralExtractor(), observed: new Uint8Array(12), running: false
    }));
    this.working = new StructuralExtractor();
    this.candidate = new Uint8Array(12);
    this.permutation = new Uint8Array(12);
    this.failed = null;
    this.comparison = new PatternSimilarity(12, 12);
    this.resetAll();
  }

  resetStream(stream) {
    if (stream.isTest) this.storage.clearSlot(12);
    this.comparison.discardFeedback();
    this.comparison.invalidate();
    stream.extractor.reset();
    stream.observed.fill(0);
    stream.start = null;
    stream.latest = -1;
    stream.missed = 0;
    stream.noiseSeed = Math.floor(Math.random() * 4294967296);
    stream.lastTime = null;
    stream.windows = 0;
    stream.inspectionWindow = '';
    stream.inspectionText = '';
    stream.inspectionSummary = 'Step or run to inspect a complete window.';
  }

  resetAll() {
    this.storage.reset();
    this.comparison.resetFeedback();
    this.failed = null;
    for (const stream of this.pool) this.resetStream(stream);
    this.working.reset();
  }

  resetSlot(stream) {
    if (!stream.isTest) this.storage.clearSlot(stream.slot);
    this.resetStream(stream);
  }

  configure(settings) {
    const plan = this.storage.plan;
    if (plan.grades !== settings.grades || plan.minimum !== settings.minimum || plan.maximum !== settings.window) {
      this.storage = new PatternAccumulator({ ...this.storageOptions, grades: settings.grades, minimum: settings.minimum, maximum: settings.window, slots: 13, streamCount: 13 });
    }
    this.resetAll();
  }

  misses(size, skipped) {
    for (let i = 0; i < size; i++) this.permutation[i] = i;
    let mask = 0;
    for (let i = 0; i < skipped; i++) {
      const selected = i + Math.floor(Math.random() * (size - i));
      const value = this.permutation[selected];
      this.permutation[selected] = this.permutation[i];
      this.permutation[i] = value;
      mask |= 1 << value;
    }
    return mask;
  }

  commitWindow(stream, start, missed, settings) {
    if (this.storage.stopped) return false;
    this.working.copyFrom(stream.extractor);
    this.storage.begin(stream.isTest ? 12 : stream.slot);
    const decomposed = this.working.process(this.candidate, start, settings.minimum, this.storage, settings.window);
    // An explicitly labeled TEST window may teach the next comparison, but only keys
    // accepted in this window are eligible for feedback after a successful commit.
    if (decomposed && stream.isTest && feedbackEnabled) this.comparison.captureFeedback(this.storage);
    else this.comparison.discardFeedback();
    if (!decomposed || !this.storage.commit()) {
      this.comparison.discardFeedback();
      // Strings are only a bounded UI failure report, outside accumulation.
      let symbols = '';
      for (let i = 0; i < settings.window; i++) symbols += '-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'[this.candidate[i]];
      this.failed = { slot: stream.slot, start, symbols, generated: this.working.generated, accepted: this.working.accepted,
        shown: this.working.debugCount, text: this.working.debugText() };
      for (const item of this.pool) {
        item.running = false;
        item.lastTime = null;
        item.latest = item.start === null ? -1 : item.start + settings.window - 1;
      }
      return false;
    }
    const previous = stream.extractor;
    stream.extractor = this.working;
    this.working = previous;
    stream.start = start;
    stream.latest = start + settings.window - 1;
    stream.missed = missed;
    stream.observed.set(this.candidate);
    stream.windows++;
    this.comparison.invalidate();
    return true;
  }
}




// app.js
'use strict';

const controls = Object.fromEntries(['delay', 'spacing', 'grades', 'window', 'minimum', 'stride', 'skips', 'jitter', 'rows'].map(id => [id, document.getElementById(id)]));
const settings = {};
const streams = [];
const container = document.getElementById('training-rows');
const template = document.getElementById('row-template');
const colors = ['#6ce2bd', '#7bbaff', '#d7a4ef', '#f2c17b'];
let experiment;

// Fixed-capacity browser experiment. Capacity exhaustion stops all streams
// without discarding committed evidence. No disk persistence is implemented.
// Compact default: same algorithms, smaller per-length capacities.
const liveStorageOptions = {
  budgetBytes: 32 * 1024 * 1024,
  rlSlots: 12,
  capacities: Object.fromEntries(Array.from({ length: 10 }, (_, index) => {
    const length = index + 3, scale = 2 ** Math.floor(index / 2);
    return [length, [Math.min(128, 16 * scale), 128 * scale, 2048 * scale]];
  }))
};

function numeric(input) {
  let value = Number(input.value);
  if (!Number.isFinite(value) || input.value.trim() === '') value = Number(input.min);
  value = Math.max(Number(input.min), Math.min(Number(input.max), value));
  if (input.step === '1') value = Math.round(value);
  input.value = value;
  return value;
}

function readSettings() {
  for (const key of ['delay', 'spacing', 'grades', 'window', 'stride', 'jitter', 'rows']) settings[key] = numeric(controls[key]);
  controls.minimum.max = settings.window;
  settings.minimum = numeric(controls.minimum);
  controls.skips.max = settings.window - 1;
  settings.skips = numeric(controls.skips);
  document.getElementById('sensor-summary').textContent = `${settings.window - settings.skips} attempted readings / window · stride Δx = ${format(settings.stride * settings.spacing)} · out-of-range readings become misses`;
}

function format(value) { return Number(value.toFixed(3)).toString(); }
function similarityText(value, measure = experiment.comparison.measure) {
  if (measure === 'affinity' || measure === 'silhouette' || measure === 'selective' || measure === 'selectiveRl' || measure === 'layered') return `${value.toFixed(1)}%`;
  if (measure === 'contrastProduct') {
    const whole = value / CONTRAST_SCALE;
    const fraction = (value % CONTRAST_SCALE).toString().padStart(6, '0').replace(/0+$/, '');
    return whole.toLocaleString() + (fraction ? `.${fraction}` : '');
  }
  return value.toLocaleString();
}
function reset(stream) {
  experiment.resetSlot(stream);
}

function addStream(isTest = false) {
  const index = streams.filter(s => !s.isTest).length;
  const element = template.content.firstElementChild.cloneNode(true);
  const stream = experiment.pool[isTest ? 0 : index + 1];
  Object.assign(stream, { element, a: isTest ? 1 : 1 + index, b: 1, f: 0, noise: settings.jitter, running: false, color: isTest ? '#f2c17b' : colors[index % colors.length] });
  reset(stream);
  const name = isTest ? 'TEST' : `Sine ${String(index + 1).padStart(2, '0')}`;
  element.querySelector('h3').textContent = name;
  element.classList.toggle('test-row', isTest);
  element.querySelector('.run-control span').textContent = isTest ? 'Run inference' : 'Run';
  element.querySelector('input[type=checkbox]').setAttribute('aria-label', `${name}: run ${isTest ? 'inference' : 'stream'}`);
  if (isTest) {
    element.querySelector('.metric > span').textContent = 'TEST dictionary';
    element.querySelector('.probability > span').textContent = 'Classes matched';
  }
  element.querySelector('input[type=checkbox]').addEventListener('change', event => {
    if (experiment.storage.stopped) { updateStorage(); return; }
    stream.running = event.target.checked;
    stream.lastTime = null;
    draw(stream);
  });
  element.querySelector('.step-stride').addEventListener('click', () => {
    if (experiment.storage.stopped) return;
    stream.running = false;
    element.querySelector('input[type=checkbox]').checked = false;
    stream.lastTime = null;
    const target = stream.start === null ? settings.window - 1 : stream.start + settings.stride + settings.window - 1;
    while (stream.latest < target && !experiment.storage.stopped) step(stream);
    element.querySelector('.inspection').open = true;
    draw(stream);
  });
  for (const input of element.querySelectorAll('[data-param]')) {
    input.value = stream[input.dataset.param];
    input.setAttribute('aria-label', `${name} ${input.dataset.param.toUpperCase()}`);
    input.addEventListener('change', () => {
      if (experiment.storage.stopped) return;
      const previousRange = quantizationRange();
      stream[input.dataset.param] = numeric(input);
      // A changed training signal invalidates any feedback learned for it.
      if (previousRange !== quantizationRange() || (!stream.isTest && stream.slot === rlCorrectSlot)) experiment.resetAll();
      else reset(stream);
      updateStorage();
      drawAll();
    });
  }
  stream.canvas = element.querySelector('canvas');
  stream.context = stream.canvas.getContext('2d');
  (isTest ? document.getElementById('test-row') : container).append(element);
  if (!isTest) {
    stream.scoreTiles = ['score-tiles', 'secondary-score-tiles'].map(id => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'score-tile';
      tile.style.setProperty('--tile-color', stream.color);
      tile.innerHTML = `<span>S${String(index + 1).padStart(2, '0')}</span><strong>—</strong>`;
      tile.addEventListener('click', () => stream.element.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      document.getElementById(id).append(tile);
      return tile;
    });
  }
  streams.push(stream);
  resizeObserver.observe(stream.canvas);
}

function step(stream) {
  if (experiment.storage.stopped) return false;
  stream.latest++;
  let nextStart = null;
  if (stream.start === null && stream.latest >= settings.window - 1) {
    nextStart = 0;
  } else if (stream.start !== null && stream.latest >= stream.start + settings.stride + settings.window - 1) {
    nextStart = stream.start + settings.stride;
  }
  if (nextStart === null) return true;
  let missed = experiment.misses(settings.window, settings.skips);
  const range = quantizationRange();
  experiment.candidate.fill(0);
  for (let offset = 0; offset < settings.window; offset++) {
    const bit = 1 << offset;
    if (missed & bit) continue;
    const index = nextStart + offset;
    const value = stream.b * Math.sin(stream.a * index * settings.spacing + stream.f) + noiseAt(stream, index);
    const grade = gradeFor(value, range);
    if (grade === null) missed |= bit;
    else experiment.candidate[offset] = gradeAlphabet.indexOf(grade) + 1;
  }
  if (!experiment.commitWindow(stream, nextStart, missed, settings)) {
    updateStorage();
    drawAll();
    return false;
  }
  inspectWindow(stream);
  updateStorage();
  return true;
}

function inspectWindow(stream) {
  const result = stream.extractor;
  stream.inspectionWindow = windowSymbols(stream);
  stream.inspectionSummary = `Positions ${stream.start}–${stream.start + settings.window - 1} · ${stream.inspectionWindow} · ${result.generated} generated · ${result.accepted} accepted · ${result.suppressed} suppressed · ${result.rejectedSpans} spans rejected (missing endpoints). Showing ${result.debugCount} of ${result.generated} generated keys${result.generated > result.debugCount ? ' (truncated)' : ''}.`;
  if (stream.isTest) {
    const classes = streams.filter(item => !item.isTest);
    const lines = ['Start\tKey\tResult\tMatching training classes'];
    for (let row = 0; row < result.debugCount; row++) {
      let key = '';
      for (let i = 0; i < result.debugLengths[row]; i++) key += '-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'[result.debugTokens[row * 12 + i]];
      const matches = classes.filter(item => experiment.storage.count(result.debugTokens, result.debugLengths[row], item.slot, row * 12) > 0);
      lines.push(`${result.debugStarts[row]}\t${key}\t${result.debugAccepted[row] ? 'accepted' : 'suppressed'}\t${matches.map(item => item.element.querySelector('h3').textContent).join(', ') || 'none'}`);
    }
    stream.inspectionText = lines.join('\n');
  }
  else {
    const lines = ['Start\tKey\tResult\tClass total'];
    for (let row = 0; row < result.debugCount; row++) {
      let key = '';
      for (let i = 0; i < result.debugLengths[row]; i++) key += '-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'[result.debugTokens[row * 12 + i]];
      const total = experiment.storage.count(result.debugTokens, result.debugLengths[row], stream.slot, row * 12);
      lines.push(`${result.debugStarts[row]}\t${key}\t${result.debugAccepted[row] ? 'accepted' : 'suppressed'}\t${total}`);
    }
    stream.inspectionText = lines.join('\n');
  }
}

function updateStorage() {
  const target = document.getElementById('feedback-target');
  const visible = streams.filter(stream => !stream.isTest);
  if (!visible.some(stream => stream.slot === rlCorrectSlot)) { rlCorrectSlot = visible[0]?.slot ?? 0; document.getElementById('feedback-enabled').checked = false; feedbackEnabled = false; }
  target.innerHTML = visible.map(stream => '<option value="' + stream.slot + '"' + (stream.slot === rlCorrectSlot ? ' selected' : '') + '>S' + String(stream.slot + 1).padStart(2, '0') + '</option>').join('');
  const store = experiment.storage;
  document.getElementById('reset-test').disabled = store.stopped;
  let middleSize = 0, middleCapacity = 0, largestSize = 0, largestCapacity = 0;
  const rows = [];
  const fullLengths = [];
  for (const bank of store.banks) {
    const middle = bank.levels[2], largest = bank.levels[3];
    middleSize += middle.size; middleCapacity += middle.capacity;
    largestSize += largest.size; largestCapacity += largest.capacity;
    const full = middle.size === middle.capacity || largest.size === largest.capacity;
    const failed = store.stopped && store.failureLength === bank.length;
    if (full) fullLengths.push(bank.length);
    rows.push(`<tr class="${failed ? 'bank-failed' : full ? 'bank-full' : ''}"><th>${bank.length}${failed ? ' · stopped' : full ? ' · full level' : ''}</th><td>${bank.levels[1].size} / ${bank.levels[1].capacity}</td><td>${middle.size} / ${middle.capacity}</td><td>${largest.size} / ${largest.capacity}</td></tr>`);
  }
  for (const [id, size, capacity] of [['middle', middleSize, middleCapacity], ['largest', largestSize, largestCapacity]]) {
    const progress = document.getElementById(`${id}-occupancy`);
    progress.max = capacity; progress.value = size;
    document.getElementById(`${id}-occupancy-label`).textContent = `${size.toLocaleString()} / ${capacity.toLocaleString()} (${(100 * size / capacity).toFixed(1)}%)`;
  }
  document.getElementById('storage-banks').innerHTML = rows.join('');
  document.getElementById('bank-summary').textContent = `Capacity by pattern length${fullLengths.length ? ' · full levels at lengths ' + fullLengths.join(', ') : ''}`;
  if (store.stopped) document.getElementById('bank-capacities').open = true;
  document.getElementById('storage-memory').textContent = `12 training slots + TEST · ${(store.plan.totalBytes / 1048576).toFixed(3)} MiB allocated / ${(store.plan.budgetBytes / 1048576).toFixed(0)} MiB budget`;
  const failure = experiment.failed;
  document.getElementById('storage-error').hidden = !store.stopped;
  if (store.stopped) {
    const reason = store.failureCode === STORE_OVERFLOW ? 'Counter overflow' : store.failureCode === STORE_BATCH_CAPACITY ? 'Stride staging capacity exhausted' : 'Dictionary capacity exhausted';
    document.getElementById('storage-error').textContent = `${reason} at length ${store.failureLength}. All streams stopped at their last completed window; stored evidence is preserved. Reset experiment to start over.`;
  }
  const failedPanel = document.getElementById('failed-stride');
  failedPanel.hidden = !failure;
  if (failure) {
    failedPanel.open = true;
    document.getElementById('failed-stride-output').textContent = `Sine ${failure.slot + 1}, attempted start ${failure.start}: ${failure.symbols}\nNOT COMMITTED · ${failure.generated} generated · ${failure.accepted} accepted by deduplication\nShowing ${failure.shown} of ${failure.generated} candidates${failure.shown < failure.generated ? ' (truncated)' : ''}.\n${failure.text}`;
  }
  for (const [key, input] of Object.entries(controls)) input.disabled = store.stopped && key !== 'delay';
  document.getElementById('start-all').disabled = store.stopped;
  const comparison = experiment.comparison;
  comparison.compute(store);
  const salience = document.getElementById('silhouette-salience');
  salience.hidden = comparison.measure !== 'silhouette' && comparison.secondaryMeasure !== 'silhouette';
  salience.textContent = `${comparison.silhouetteRetainedKeys.toLocaleString()} of ${comparison.silhouetteConsideredKeys.toLocaleString()} keys retained (contrast ≥ 0.20)`;
  const voters = document.getElementById('selective-voters');
  voters.hidden = !['selective', 'selectiveRl', 'layered'].includes(comparison.measure) &&
    !['selective', 'selectiveRl', 'layered'].includes(comparison.secondaryMeasure);
  voters.textContent = `${comparison.selectedVoters.toLocaleString()} voting keys selected (at most 64 per length)`;
  const feedback = document.getElementById('rl-feedback');
  feedback.hidden = comparison.measure !== 'selectiveRl' && comparison.secondaryMeasure !== 'selectiveRl';
  feedback.textContent = `S${String(rlCorrectSlot + 1).padStart(2, "0")} labeled feedback · ${comparison.rlRewards.toLocaleString()} rewarded · ${comparison.rlPenalties.toLocaleString()} penalized · teaching ${document.getElementById("feedback-enabled").checked ? "on" : "off"}`;
  const recruitment = document.getElementById('layered-recruitment');
  recruitment.hidden = comparison.measure !== 'layered' && comparison.secondaryMeasure !== 'layered';
  recruitment.textContent = `${comparison.layeredVotersUsed.toLocaleString()} of ${comparison.selectedVoters.toLocaleString()} voters used · ${comparison.layeredLayersUsed} complexity layers${comparison.layeredStoppedEarly ? ' · decisive lead reached' : ''}`;
  const trainingStreams = streams.filter(item => !item.isTest);
  let visibleScores, bestScore, zero;
  for (const [panel, measure, scores] of [[0, comparison.measure, comparison.scores], [1, comparison.secondaryMeasure, comparison.secondaryScores]]) {
    const product = measure === 'weightedProduct' || measure === 'contrastProduct';
    const panelZero = product ? 0n : 0;
    const panelScores = trainingStreams.map(item => scores[item.slot]);
    const panelBest = panelScores.reduce((best, score) => score > best ? score : best, panelZero);
    const scoreTotal = panelScores.reduce((sum, score) => sum + score, panelZero);
    for (const item of trainingStreams) {
      const score = scores[item.slot];
      const share = scoreTotal > panelZero ? `${product
        ? (Number((score * 1000n + scoreTotal / 2n) / scoreTotal) / 10).toFixed(1)
        : (100 * score / scoreTotal).toFixed(1)}%` : '—';
      const tile = item.scoreTiles[panel];
      tile.querySelector('strong').textContent = share;
      tile.classList.toggle('score-leader', comparison.ready && score > panelZero && score === panelBest);
      tile.title = `${item.element.querySelector('h3').textContent}: ${similarityText(score, measure)} ${SIMILARITY_MEASURES[measure].label.toLowerCase()} · ${share} of visible similarity scores`;
      tile.setAttribute('aria-label', `${item.element.querySelector('h3').textContent}, ${share} score share, ${similarityText(score, measure)} ${SIMILARITY_MEASURES[measure].label.toLowerCase()}. Jump to row.`);
    }
    if (panel === 0) { visibleScores = panelScores; bestScore = panelBest; zero = panelZero; }
  }
  for (const stream of streams) {
    const metric = stream.element.querySelector('.probability');
    metric.querySelector('strong').textContent = comparison.ready
      ? (stream.isTest ? visibleScores.filter(score => score > zero).length.toLocaleString() : similarityText(comparison.scores[stream.slot]))
      : '—';
    metric.querySelector('small').textContent = comparison.ready ? (stream.isTest ? 'Classes sharing keys' : comparison.measure === 'affinity' ? '0–100% histogram affinity' : comparison.measure === 'silhouette' ? '0–100% weighted similarity' : comparison.measure === 'selective' ? '0–100% selective vote' : comparison.measure === 'selectiveRl' ? '0–100% RL-adjusted vote' : comparison.measure === 'layered' ? '0–100% layered vote' : comparison.measure === 'weightedProduct' ? 'Raw weighted product' : comparison.measure === 'contrastProduct' ? 'Observed-token product with contrast' : 'Shared distinct keys') : 'Step TEST to compare';
    metric.classList.toggle('score-leader', !stream.isTest && comparison.ready && bestScore > zero && comparison.scores[stream.slot] === bestScore);
    if (!stream.isTest) metric.style.setProperty('--score-color', stream.color);
    if (stream.isTest) {
      stream.element.querySelector('.metric strong').textContent = store.distinct[12].toLocaleString();
      stream.element.querySelector('.metric small').textContent = stream.windows ? `${stream.windows} committed windows` : 'Untrained';
    }
    const run = stream.element.querySelector('input[type=checkbox]');
    run.checked = stream.running; run.disabled = store.stopped;
    stream.element.querySelector('.step-stride').disabled = store.stopped;
    for (const input of stream.element.querySelectorAll('[data-param]')) input.disabled = store.stopped;
  }
}

// Stable per sample, without an ever-growing sample buffer. Repainting or
// revisiting an overlapping window must not change a reading's noise.
function noiseAt(stream, index) {
  let hash = (index ^ stream.noiseSeed) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97);
  hash = (hash ^ (hash >>> 15)) >>> 0;
  return (hash / 4294967295 * 2 - 1) * stream.b * stream.noise / 100;
}

const gradeAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
function quantizationRange() { return Math.max(1, ...streams.map(s => Math.abs(s.b))); }
function gradeFor(value, range = quantizationRange()) {
  // Outside the shared nominal sensor range there is no quantized reading.
  if (value < -range || value > range) return null;
  const index = Math.max(0, Math.min(settings.grades - 1,
    Math.round((value + range) / (2 * range) * (settings.grades - 1))));
  return gradeAlphabet[index];
}
function windowSymbols(stream) {
  if (stream.start === null) return '';
  return Array.from({ length: settings.window }, (_, offset) =>
    stream.observed[offset] ? gradeAlphabet[stream.observed[offset] - 1] : '*').join('');
}

function draw(stream) {
  if (!stream.isTest) {
    stream.element.querySelector('.metric strong').textContent = experiment.storage.distinct[stream.slot].toLocaleString();
    stream.element.querySelector('.metric small').textContent = stream.windows ? `${stream.windows} committed windows` : 'Untrained';
  }
  stream.element.querySelector('.inspection-summary').textContent = stream.inspectionSummary;
  stream.element.querySelector('.inspection-output').textContent = stream.inspectionText;
  const { canvas, context: ctx } = stream;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const left = 40, right = w - 14, top = 20, bottom = h - 28;
  const width = right - left, height = bottom - top;
  const amplitude = Math.max(1, ...streams.map(s => Math.abs(s.b) * (1 + s.noise / 100)));
  const gradeRange = quantizationRange();
  const extent = Math.max(6 * Math.PI, (settings.window - 1) * settings.spacing * 2.5);
  const windowEnd = stream.start === null ? 0 : (stream.start + settings.window - 1) * settings.spacing;
  const origin = Math.max(0, windowEnd - extent * 0.8);
  const px = x => left + (x - origin) / extent * width;
  const py = y => top + height / 2 - y / (amplitude * 1.2) * height / 2;
  const value = x => stream.b * Math.sin(stream.a * x + stream.f);
  ctx.font = '10px Consolas, monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i < settings.grades; i++) {
    const y = -gradeRange + 2 * gradeRange * i / (settings.grades - 1);
    ctx.strokeStyle = '#20303e'; ctx.setLineDash([2, 5]);
    ctx.beginPath(); ctx.moveTo(left, py(y)); ctx.lineTo(right, py(y)); ctx.stroke();
    if (settings.grades <= 12 || i === 0 || i === settings.grades - 1) {
      ctx.fillStyle = '#9eb5c5'; ctx.fillText(gradeAlphabet[i], left - 8, py(y) + 3);
    }
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = '#354858'; ctx.beginPath(); ctx.moveTo(left, py(0)); ctx.lineTo(right, py(0)); ctx.stroke();
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const x = origin + extent * i / 4;
    ctx.fillStyle = '#70889b'; ctx.fillText(format(x), px(x), bottom + 18);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, width, height); ctx.clip();
  if (stream.start !== null) {
    const x1 = px(stream.start * settings.spacing), x2 = px((stream.start + settings.window - 1) * settings.spacing);
    ctx.fillStyle = `${stream.color}16`; ctx.fillRect(x1, top, x2 - x1, height);
    ctx.strokeStyle = `${stream.color}70`; ctx.strokeRect(x1, top, x2 - x1, height);
  }
  const end = Math.min(origin + extent, stream.latest * settings.spacing);
  // The unobserved continuation is a visual preview only, never sampled.
  ctx.strokeStyle = `${stream.color}50`; ctx.lineWidth = 1.3; ctx.beginPath();
  const futureStart = Math.max(origin, end);
  const futureSegments = Math.min(12000, Math.max(Math.ceil(width * 2), Math.ceil(extent * stream.a * 12)));
  for (let i = 0; i <= futureSegments; i++) {
    const x = futureStart + (origin + extent - futureStart) * i / futureSegments;
    if (i === 0) ctx.moveTo(px(x), py(value(x))); else ctx.lineTo(px(x), py(value(x)));
  }
  ctx.stroke(); ctx.lineWidth = 1;
  if (end >= origin) {
    ctx.strokeStyle = stream.color; ctx.lineWidth = 1.6; ctx.beginPath();
    const segments = Math.min(12000, Math.max(Math.ceil(width * 2), Math.ceil((end - origin) * stream.a * 12)));
    for (let i = 0; i <= segments; i++) {
      const x = origin + (end - origin) * i / segments;
      if (i === 0) ctx.moveTo(px(x), py(value(x))); else ctx.lineTo(px(x), py(value(x)));
    }
    ctx.stroke(); ctx.lineWidth = 1;
    const first = Math.max(0, Math.ceil(origin / settings.spacing));
    const last = Math.min(stream.latest, Math.floor((origin + extent) / settings.spacing));
    for (let i = first; i <= last; i++) {
      const actual = stream.start !== null && i >= stream.start && i < stream.start + settings.window && !(stream.missed & (1 << (i - stream.start)));
      const x = i * settings.spacing;
      ctx.beginPath(); ctx.arc(px(x), py(value(x) + (actual ? noiseAt(stream, i) : 0)), actual ? 4 : 1.8, 0, Math.PI * 2);
      ctx.fillStyle = actual ? stream.color : '#8aa5b8'; ctx.fill();
      if (actual) { ctx.strokeStyle = '#0c1820'; ctx.stroke(); }
    }
  }
  ctx.restore();
  const symbols = stream.element.querySelector('.window-symbols');
  symbols.textContent = windowSymbols(stream);
  symbols.style.color = stream.color;
  const symbolCenter = stream.start === null ? left : px((stream.start + (settings.window - 1) / 2) * settings.spacing);
  const symbolWidth = Math.min(Math.max(100, settings.window * 8 + 16), Math.max(100, width));
  symbols.style.width = `${symbolWidth}px`;
  symbols.style.marginLeft = `${Math.max(left, Math.min(right - symbolWidth, symbolCenter - symbolWidth / 2))}px`;
  symbols.title = symbols.textContent ? `Window symbols: ${symbols.textContent}. A is lowest; * is a missed sample.` : 'Waiting for a complete window';
  if (stream.latest < 0) {
    ctx.fillStyle = '#698193'; ctx.textAlign = 'center'; ctx.fillText('Check Run to begin sampling at x = 0', left + width / 2, top + 30);
  }
  const state = experiment.storage.stopped ? 'Stopped' : stream.running ? 'Running' : stream.latest < 0 ? 'Ready' : 'Paused';
  stream.element.querySelector('.formula').textContent = `y = ${format(stream.b)} sin(${format(stream.a)}x + ${format(stream.f)})`;
  stream.element.querySelector('summary').textContent = `Parameters · jitter ${stream.noise}%`;
  stream.element.querySelector('.status').textContent = `${state} · ${stream.latest + 1} potential samples`;
  stream.element.querySelector('.chart-caption').textContent = stream.start === null
    ? `Window waiting · ${Math.max(0, stream.latest + 1)} / ${settings.window} positions`
    : `Window x: ${format(stream.start * settings.spacing)} → ${format((stream.start + settings.window - 1) * settings.spacing)} · next: ${format((stream.start + settings.stride) * settings.spacing)}`;
}

function drawAll() { streams.forEach(draw); }
const resizeObserver = new ResizeObserver(drawAll);
readSettings();
experiment = new LiveExperiment(settings, liveStorageOptions);
addStream(true);
while (streams.length - 1 < settings.rows) addStream();
for (const [key, input] of Object.entries(controls)) {
  input.addEventListener('change', () => {
    if (experiment.storage.stopped && key !== 'delay') return;
    const previousRange = quantizationRange();
    readSettings();
    if (key === 'jitter') {
      for (const stream of streams) {
        if (stream.noise !== settings.jitter) reset(stream);
        stream.noise = settings.jitter;
        stream.element.querySelector('[data-param="noise"]').value = settings.jitter;
      }
    }
    while (streams.length - 1 < settings.rows) addStream();
    while (streams.length - 1 > settings.rows) {
      const removed = streams.pop(); reset(removed); removed.running = false; resizeObserver.unobserve(removed.canvas); removed.element.remove(); removed.scoreTiles.forEach(tile => tile.remove());
    }
    if (['spacing', 'window', 'minimum', 'stride', 'skips', 'grades'].includes(key) || previousRange !== quantizationRange()) experiment.configure(settings);
    updateStorage();
    drawAll();
  });
}
document.getElementById('feedback-target').addEventListener('change', event => {
  rlCorrectSlot = Number(event.target.value);
  // Old class rewards cannot be reassigned to a newly chosen label.
  experiment.resetAll(); updateStorage(); drawAll();
});
document.getElementById('feedback-enabled').addEventListener('change', event => {
  feedbackEnabled = event.target.checked;
  experiment.comparison.discardFeedback(); updateStorage();
});
document.getElementById('reset').addEventListener('click', () => { experiment.resetAll(); updateStorage(); drawAll(); });
document.getElementById('start-all').addEventListener('click', () => {
  if (experiment.storage.stopped) return;
  for (const stream of streams) {
    stream.running = true;
    stream.lastTime = null;
    stream.element.querySelector('input[type=checkbox]').checked = true;
  }
  drawAll();
});
document.getElementById('pause-all').addEventListener('click', () => {
  for (const stream of streams) {
    stream.running = false;
    stream.lastTime = null;
    stream.element.querySelector('input[type=checkbox]').checked = false;
  }
  drawAll();
});
document.getElementById('reset-test').addEventListener('click', () => {
  const stream = streams.find(item => item.isTest);
  stream.running = false;
  reset(stream);
  updateStorage();
  drawAll();
});
document.getElementById('similarity-measure').addEventListener('change', event => {
  experiment.comparison.select(event.target.value);
  updateStorage();
});
document.getElementById('secondary-similarity-measure').addEventListener('change', event => {
  experiment.comparison.select(event.target.value, 1);
  updateStorage();
});
function animate(time) {
  for (const stream of streams) {
    if (!stream.running) continue;
    if (stream.lastTime === null || time - stream.lastTime >= settings.delay) {
      step(stream); if (!experiment.storage.stopped) stream.lastTime = time; draw(stream);
    }
  }
  requestAnimationFrame(animate);
}
updateStorage();
drawAll();
requestAnimationFrame(animate);
