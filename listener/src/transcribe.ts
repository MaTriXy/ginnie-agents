/**
 * Voice-message transcription via whisper.cpp.
 *
 * Wired into the message handler in index.ts. When Slack delivers an audio
 * file (voice memo or attached audio clip), the transcript replaces the
 * usual "here's a download command" stub so the agent receives plain text
 * instead of a file pointer it cannot open.
 *
 * Whisper.cpp + the model are installed *eagerly* by `scripts/install-whisper.sh`
 * (run from the setup skill, on user opt-in). This module is purely a runtime
 * shim — if the binary or model is missing it logs once and returns null,
 * letting audio fall back to the standard download-stub behavior.
 *
 * Cost / privacy: zero network calls per transcription, fully local CPU.
 */

import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const WHISPER_DIR = path.join(__dirname, "..", ".whisper");
const WHISPER_REPO = path.join(WHISPER_DIR, "whisper.cpp");
const MODEL_DIR = path.join(WHISPER_REPO, "models");
const MODEL_NAME = "ggml-small.bin";
const MODEL_PATH = path.join(MODEL_DIR, MODEL_NAME);

// Modern whisper.cpp (CMake) puts the binary at build/bin/whisper-cli.
// Older Make builds produced ./main. We probe both.
const BIN_CANDIDATES = [
	path.join(WHISPER_REPO, "build", "bin", "whisper-cli"),
	path.join(WHISPER_REPO, "main"),
];

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB — well above any Slack voice memo
const TRANSCRIBE_TIMEOUT_MS = 5 * 60_000; // 5min cap for very long audio

let warnedMissing = false;

export function isAudioMime(mime: string): boolean {
	return /^audio\//i.test(mime);
}

export async function transcribeAudio(
	url: string,
	slackToken: string,
): Promise<string | null> {
	const bin = findBinary();
	if (!bin || !fs.existsSync(MODEL_PATH)) {
		if (!warnedMissing) {
			warnedMissing = true;
			console.warn(
				"[transcribe] whisper.cpp not installed — audio attachments will pass " +
				"through as download stubs. Run `scripts/install-whisper.sh` (or re-run " +
				"the setup skill and answer yes to the voice-transcription prompt).",
			);
		}
		return null;
	}

	const id = crypto.randomBytes(8).toString("hex");
	const audioPath = path.join(os.tmpdir(), `ginnie-voice-${id}.audio`);
	const wavPath = path.join(os.tmpdir(), `ginnie-voice-${id}.wav`);

	try {
		await downloadAudio(url, slackToken, audioPath);
		await convertToWav(audioPath, wavPath);
		const text = await runWhisper(bin, wavPath);
		return text.trim() || null;
	} catch (e) {
		console.error("[transcribe] failed:", (e as Error).message);
		return null;
	} finally {
		try { fs.unlinkSync(audioPath); } catch {}
		try { fs.unlinkSync(wavPath); } catch {}
	}
}

function findBinary(): string | null {
	for (const p of BIN_CANDIDATES) if (fs.existsSync(p)) return p;
	return null;
}

async function downloadAudio(url: string, slackToken: string, dest: string): Promise<void> {
	const res = await fetch(url, { headers: { Authorization: `Bearer ${slackToken}` } });
	if (!res.ok) throw new Error(`Slack download HTTP ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.length > MAX_AUDIO_BYTES) {
		throw new Error(`audio too large (${buf.length} bytes, cap ${MAX_AUDIO_BYTES})`);
	}
	fs.writeFileSync(dest, buf);
}

async function convertToWav(src: string, dst: string): Promise<void> {
	// whisper.cpp requires 16kHz mono 16-bit PCM WAV.
	await run("ffmpeg", ["-y", "-i", src, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", dst]);
}

async function runWhisper(bin: string, wavPath: string): Promise<string> {
	// `-otxt` writes <wav>.txt next to the input; `-nt` suppresses timestamps;
	// `-l auto` lets whisper detect language (needed for Hebrew + English mix).
	const out = await run(bin, [
		"-m", MODEL_PATH,
		"-f", wavPath,
		"-otxt",
		"-nt",
		"-l", "auto",
	], { timeoutMs: TRANSCRIBE_TIMEOUT_MS });

	const txtPath = wavPath + ".txt";
	if (fs.existsSync(txtPath)) {
		const text = fs.readFileSync(txtPath, "utf8");
		try { fs.unlinkSync(txtPath); } catch {}
		return text;
	}
	// Older whisper.cpp prints to stdout when -otxt isn't honored.
	return out;
}

interface RunOpts { cwd?: string; timeoutMs?: number; }

function run(cmd: string, args: string[], opts: RunOpts = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const timer = opts.timeoutMs ? setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
		}, opts.timeoutMs) : null;
		child.stdout.on("data", (d) => stdout += d.toString());
		child.stderr.on("data", (d) => stderr += d.toString());
		child.on("error", (e) => { if (timer) clearTimeout(timer); reject(e); });
		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			if (code === 0) resolve(stdout);
			else reject(new Error(`${cmd} exited ${code}: ${stderr.trim().slice(0, 500)}`));
		});
	});
}
