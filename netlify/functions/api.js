// Menggunakan Netlify KV
import { getStore } from "@netlify/kv-store";

const STATE_KEY = 'scoreboard_state_netlify'; // Key KV bisa beda
const INITIAL_TIME_MS = 180 * 1000; // 3 menit

// Fungsi cek pemenang
function cekPemenang(state, currentRemainingTime) {
  // Pastikan state ada sebelum akses properti
  if (!state) return null;
  if (state.winnerName) return state.winnerName;

  const skorKiri = parseInt(state.skorKiri) || 0;
  const skorKanan = parseInt(state.skorKanan) || 0;
  // Validasi currentRemainingTime dengan lebih hati-hati
  const remaining = (typeof currentRemainingTime === 'number' && !isNaN(currentRemainingTime) && currentRemainingTime >= 0) ? currentRemainingTime : 0;

  const selisih = Math.abs(skorKiri - skorKanan);
  if (skorKiri >= 10) return state.namaKiri;
  if (skorKanan >= 10) return state.namaKanan;
  if (selisih >= 8 && (skorKiri > 0 || skorKanan > 0)) {
    return skorKiri > skorKanan ? state.namaKiri : state.namaKanan;
  }
  // Cek waktu habis hanya jika timer TIDAK jalan & waktu <= 0
  // Gunakan state.remainingTime (waktu tersimpan) untuk cek akhir
  if (!state.timerRunning && state.remainingTime <= 0) {
      // console.log("[CEK PEMENANG Netlify] Waktu habis terdeteksi (timer stop, remaining <= 0).");
      if (skorKiri > skorKanan) return state.namaKiri;
      else if (skorKanan > skorKiri) return state.namaKanan;
      else return "SERI";
  }
   // Cek juga jika currentRemainingTime habis (meskipun timer belum tentu stop di state)
   if (remaining <= 0 && state.remainingTime > 0 && state.timerRunning) {
        // console.log("[CEK PEMENANG Netlify] Waktu habis terdeteksi (currentRemaining <= 0 saat running).");
        if (skorKiri > skorKanan) return state.namaKiri;
        else if (skorKanan > skorKiri) return state.namaKanan;
        else return "SERI";
   }
  return null;
}

// State default
const getDefaultState = () => ({
    skorKiri: 0,
    skorKanan: 0,
    namaKiri: "PEMAIN 1",
    namaKanan: "PEMAIN 2",
    timerRunning: false,
    remainingTime: INITIAL_TIME_MS, // Waktu tersimpan saat pause/reset
    lastStartTime: 0, // Kapan terakhir start/resume
    winnerName: null
});


// Handler untuk Netlify Functions
export const handler = async (event, context) => {
  const handlerStartTime = Date.now();
  // Ambil query parameters dari event
  const q = event.queryStringParameters || {};
  console.log(`[API Netlify V6] Request: ${event.path}?${new URLSearchParams(q).toString()}`); // Label V6

  try {
    // Dapatkan akses ke KV store 'scoreboard'
    const kvStore = await getStore("scoreboard");
    let stateString = await kvStore.get(STATE_KEY);
    let state;

    // Parse state atau inisialisasi
    try {
        state = stateString ? JSON.parse(stateString) : null;
    } catch (parseError) {
        console.error("[API Netlify V6] Gagal parse state -> Reset:", parseError);
        state = null;
    }

    // Validasi state awal
    if (!state || typeof state.remainingTime !== 'number' || isNaN(state.remainingTime)) {
      console.log("[API Netlify V6] State awal tidak valid/kosong -> Reset.");
      state = getDefaultState();
      // Simpan state default (stringify dulu)
      await kvStore.set(STATE_KEY, JSON.stringify(state));
    } else {
      // Pastikan semua field ada & valid
      state = { ...getDefaultState(), ...state };
      state.skorKiri = parseInt(state.skorKiri) || 0;
      state.skorKanan = parseInt(state.skorKanan) || 0;
      state.timerRunning = state.timerRunning === true;
      state.remainingTime = (typeof state.remainingTime === 'number' && !isNaN(state.remainingTime)) ? Math.max(0, state.remainingTime) : INITIAL_TIME_MS;
      if (!state.timerRunning) state.remainingTime = Math.min(INITIAL_TIME_MS, state.remainingTime);
      state.lastStartTime = parseInt(state.lastStartTime) || 0;
      state.winnerName = state.winnerName || null;
    }
    // console.log("[API Netlify V6] State AWAL:", JSON.stringify(state));

    let stateChanged = false;
    const now = Date.now();

    // --- Hitung Sisa Waktu Saat Ini ---
    let currentRemainingTime = state.remainingTime;
    if (state.timerRunning && !state.winnerName && state.lastStartTime > 0) {
         const elapsedSinceStart = now - state.lastStartTime;
         currentRemainingTime = Math.max(0, state.remainingTime - elapsedSinceStart);
         // Jika waktu habis -> update state di Cek Pemenang
    }
    currentRemainingTime = (typeof currentRemainingTime === 'number' && !isNaN(currentRemainingTime)) ? Math.max(0, currentRemainingTime) : 0;
    // console.log(`[TIMER Netlify V6] CurrentRemainingTime: ${currentRemainingTime}`);


    // --- Pemrosesan Input ---
    if (!state.winnerName) {
        // Skor
        const skorKiriInput = parseInt(q.score_kiri);
        const skorKananInput = parseInt(q.score_kanan);
        if (state.timerRunning && currentRemainingTime > 0) {
            if (!isNaN(skorKiriInput) && skorKiriInput > 0) {
                 state.skorKiri += skorKiriInput; stateChanged = true; console.log(`[SKOR Netlify V6] Kiri +${skorKiriInput}`);
            } else if (!isNaN(skorKananInput) && skorKananInput > 0) {
                 state.skorKanan += skorKananInput; stateChanged = true; console.log(`[SKOR Netlify V6] Kanan +${skorKananInput}`);
            }
        } else if (!isNaN(skorKiriInput) || !isNaN(skorKananInput)) {
             console.log("[SKOR Netlify V6] Input skor diabaikan.");
        }
        // Nama
        if (!state.timerRunning) {
            if (q.nama_kiri) { state.namaKiri = q.nama_kiri; stateChanged = true; }
            if (q.nama_kanan) { state.namaKanan = q.nama_kanan; stateChanged = true; }
        }
        // Timer Control
        if (q.start_timer || (q.toggle_timer && !state.timerRunning)) {
            if (!state.timerRunning && state.remainingTime > 0) {
                state.timerRunning = true; state.lastStartTime = now; stateChanged = true;
                console.log("[TIMER Netlify V6] Action: START/RESUME. Sisa:", state.remainingTime);
                currentRemainingTime = state.remainingTime;
            } else { console.log("[TIMER Netlify V6] Action: START/TOGGLE-ON diabaikan."); }
        }
        else if (q.stop_timer || (q.toggle_timer && state.timerRunning)) {
            if (state.timerRunning) {
                state.timerRunning = false;
                const elapsed = now - state.lastStartTime;
                const newRemaining = (state.lastStartTime > 0 && !isNaN(elapsed)) ? Math.max(0, state.remainingTime - elapsed) : state.remainingTime;
                state.remainingTime = (typeof newRemaining === 'number' && !isNaN(newRemaining)) ? newRemaining : 0;
                state.lastStartTime = 0; stateChanged = true;
                console.log("[TIMER Netlify V6] Action: PAUSE. Sisa disimpan:", state.remainingTime);
                currentRemainingTime = state.remainingTime; // Update current time juga
            } else { console.log("[TIMER Netlify V6] Action: PAUSE/TOGGLE-OFF diabaikan."); }
        }
    }

    // --- Reset ---
    if (q.reset_skor) {
      console.log("[RESET Netlify V6] Input: reset_skor");
      state = getDefaultState(); stateChanged = true;
      currentRemainingTime = state.remainingTime;
      console.log("  -> Action: State direset.");
      // Hapus key wasit lama jika ada (opsional)
      // await getStore("scoreboard").del('referee_inputs').catch(err => console.warn("Gagal hapus key wasit:", err));
    }

    // --- Cek Pemenang ---
     if (state.timerRunning && currentRemainingTime <= 0 && state.remainingTime > 0) {
         state.timerRunning = false; state.remainingTime = 0; state.lastStartTime = 0; stateChanged = true; currentRemainingTime = 0;
         console.log("[TIMER Netlify V6] Waktu habis saat cek akhir.");
     }
    const pemenang = cekPemenang(state, currentRemainingTime);
    if (pemenang && !state.winnerName) {
        state.winnerName = pemenang;
        if (state.timerRunning) {
             state.timerRunning = false;
             // Gunakan currentRemainingTime yang sudah dihitung
             state.remainingTime = currentRemainingTime > 0 ? currentRemainingTime : 0;
             state.lastStartTime = 0; currentRemainingTime = state.remainingTime;
             console.log("[PEMENANG Netlify V6] Timer dihentikan. Sisa:", state.remainingTime);
        } else if (currentRemainingTime <= 0 && state.remainingTime >= 0) {
             if (state.remainingTime !== 0) state.remainingTime = 0;
        }
        stateChanged = true;
        console.log("[PEMENANG Netlify V6] Ditemukan:", pemenang);
    }

    // --- Simpan State jika Berubah ---
    if (stateChanged) {
      // Validasi akhir sebelum simpan
      state.remainingTime = (typeof state.remainingTime === 'number' && !isNaN(state.remainingTime)) ? Math.max(0, Math.min(INITIAL_TIME_MS, state.remainingTime)) : 0;
      state.lastStartTime = parseInt(state.lastStartTime) || 0;
      state.skorKiri = parseInt(state.skorKiri) || 0;
      state.skorKanan = parseInt(state.skorKanan) || 0;
      state.timerRunning = state.timerRunning === true;
      state.winnerName = state.winnerName || null;

      try {
          // Simpan sebagai string JSON
          await kvStore.set(STATE_KEY, JSON.stringify(state));
          console.log("[API Netlify V6] State disimpan:", JSON.stringify(state));
      } catch (kvError) {
           console.error("[API Netlify V6] Gagal menyimpan state ke KV:", kvError);
           // Return format Netlify Functions error
           return { statusCode: 500, body: JSON.stringify({ error: 'KV Set Error', details: kvError.message }) };
      }
    }

    // --- Kirim Respons ---
    const finalCurrentRemaining = (typeof currentRemainingTime === 'number' && !isNaN(currentRemainingTime)) ? currentRemainingTime : (state.remainingTime ?? 0);
    const responseState = { ...state, currentRemainingTime: finalCurrentRemaining };
    const handlerEndTime = Date.now();
    // console.log(`[API Netlify V6] Mengirim respons (${handlerEndTime - handlerStartTime}ms):`, JSON.stringify(responseState));
    // Return format Netlify Functions
    return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(responseState),
    };

  } catch (error) {
    console.error("[API Netlify V6] Error Handler:", error);
     try {
         const defaultState = getDefaultState();
         console.log("[API Netlify V6] Mengirim fallback state karena error.");
         return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...defaultState, currentRemainingTime: defaultState.remainingTime, error: 'Internal Server Error (fallback)', details: error.message }),
        };
     } catch (fallbackError) {
         console.error("[API Netlify V6] Error saat mengirim fallback state:", fallbackError);
         return { statusCode: 500, body: 'Internal Server Error' };
     }
  }
};