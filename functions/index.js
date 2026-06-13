/**
 * Firebase Cloud Functions — Jogo da Memória 🌸
 *
 * Dispara notificações push FCM nos seguintes eventos:
 *  1. Novo duelo criado   → avisa player2 que foi desafiado
 *  2. Duelo aceito        → avisa player1 que o desafio foi aceito
 *  3. Duelo recusado      → avisa player1 que o desafio foi recusado
 *  4. Duelo finalizado    → avisa o perdedor (e avisa ambos em empate)
 *  5. Presente recebido   → avisa o destinatário
 *  6. Mensagem recebida   → avisa o destinatário
 *
 * Deploy:
 *   firebase init functions   (escolha JavaScript, instale deps)
 *   firebase deploy --only functions
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp }   = require('firebase-admin/app');
const { getFirestore }    = require('firebase-admin/firestore');
const { getMessaging }    = require('firebase-admin/messaging');

initializeApp();
const db  = getFirestore();
const fcm = getMessaging();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Busca o FCM token salvo em fcm_tokens/{uid}
 * Retorna string do token ou null se não existir / não tiver permissão
 */
async function getToken(uid) {
  if (!uid) return null;
  try {
    const snap = await db.doc(`fcm_tokens/${uid}`).get();
    return snap.exists ? snap.data().token || null : null;
  } catch (e) {
    console.warn(`getToken(${uid}) falhou:`, e.message);
    return null;
  }
}

/**
 * Envia uma notificação FCM para um único token
 * Retorna true se enviou, false se o token está inválido (token removido do Firestore)
 */
async function sendPush(token, title, body, data = {}) {
  if (!token) return false;
  try {
    await fcm.send({
      token,
      notification: { title, body },
      webpush: {
        notification: {
          title,
          body,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          requireInteraction: false,
        },
        fcmOptions: { link: '/' },
      },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
    });
    return true;
  } catch (e) {
    // Token expirado ou inválido — limpar do Firestore
    if (
      e.code === 'messaging/registration-token-not-registered' ||
      e.code === 'messaging/invalid-registration-token'
    ) {
      console.warn(`Token inválido para push, removendo: ${token.slice(0, 20)}...`);
      // Encontrar uid pelo token e remover
      const snap = await db
        .collection('fcm_tokens')
        .where('token', '==', token)
        .limit(1)
        .get();
      snap.forEach(d => d.ref.delete());
    } else {
      console.error('sendPush error:', e.message);
    }
    return false;
  }
}

// ── 1. Novo duelo criado → notificar player2 ─────────────────────────────────
exports.onDuelCreated = onDocumentCreated('duels/{duelId}', async (event) => {
  const duel = event.data.data();
  if (!duel || duel.status !== 'pending') return;

  const token = await getToken(duel.player2);
  const challenger = duel.player1Name || 'Alguém';
  const avatar     = duel.player1Avatar || '🌸';
  const betText    = duel.bet > 0 ? ` · 🪙 ${duel.bet} moedas em jogo` : ' · Duelo amistoso';

  await sendPush(
    token,
    '⚔️ Novo Desafio!',
    `${avatar} ${challenger} quer duelar com você!${betText}`,
    { type: 'duel_challenge', duelId: event.params.duelId }
  );
});

// ── 2–4. Duelo atualizado → aceito / recusado / finalizado ──────────────────
exports.onDuelUpdated = onDocumentUpdated('duels/{duelId}', async (event) => {
  const before = event.data.before.data();
  const after  = event.data.after.data();
  if (!before || !after) return;

  const duelId = event.params.duelId;

  // ── Aceito ────────────────────────────────────────────────────
  if (before.status === 'pending' && after.status === 'accepted') {
    const token = await getToken(after.player1);
    const name  = after.player2Name || 'Sua oponente';
    const av    = after.player2Avatar || '🌸';
    await sendPush(
      token,
      '✅ Desafio Aceito!',
      `${av} ${name} aceitou seu desafio! O duelo começou 🎮`,
      { type: 'duel_accepted', duelId }
    );
    return;
  }

  // ── Recusado ──────────────────────────────────────────────────
  if (before.status === 'pending' && after.status === 'declined') {
    const token = await getToken(after.player1);
    const name  = after.player2Name || 'Sua oponente';
    await sendPush(
      token,
      '❌ Desafio Recusado',
      `${name} recusou seu desafio de duelo.`,
      { type: 'duel_declined', duelId }
    );
    return;
  }

  // ── Finalizado ────────────────────────────────────────────────
  if (before.status !== 'finished' && after.status === 'finished') {
    const winner = after.winner; // uid do vencedor ou 'draw'

    if (winner === 'draw') {
      // Empate — avisa ambos
      const [t1, t2] = await Promise.all([
        getToken(after.player1),
        getToken(after.player2),
      ]);
      await Promise.all([
        sendPush(t1, '🤝 Empate!', 'O duelo terminou em empate! Nenhuma moeda trocou de mãos.', { type: 'duel_draw', duelId }),
        sendPush(t2, '🤝 Empate!', 'O duelo terminou em empate! Nenhuma moeda trocou de mãos.', { type: 'duel_draw', duelId }),
      ]);
    } else {
      // Tem vencedor — notifica apenas o perdedor
      const loserUid  = winner === after.player1 ? after.player2 : after.player1;
      const loserName = winner === after.player1 ? after.player2Name : after.player1Name;
      const winName   = winner === after.player1 ? after.player1Name : after.player2Name;
      const winAv     = winner === after.player1 ? (after.player1Avatar || '🌸') : (after.player2Avatar || '🌸');
      const betText   = after.bet > 0 ? ` Você perdeu 🪙 ${after.bet} moedas.` : '';

      const token = await getToken(loserUid);
      await sendPush(
        token,
        '😿 Você perdeu o duelo',
        `${winAv} ${winName} venceu!${betText} Revanche?`,
        { type: 'duel_lost', duelId }
      );
    }
    return;
  }

  // ── Abandonado (W.O.) ─────────────────────────────────────────
  if (before.status !== 'abandoned' && after.status === 'abandoned') {
    const winner = after.winner;
    if (!winner || winner === 'draw') return;
    // Avisa o vencedor por W.O.
    const token   = await getToken(winner);
    const oppName = winner === after.player1 ? after.player2Name : after.player1Name;
    await sendPush(
      token,
      '🏆 Vitória por W.O.!',
      `${oppName} abandonou o duelo. Você venceu! 🎉`,
      { type: 'duel_wo', duelId }
    );
  }
});

// ── 5. Presente recebido ──────────────────────────────────────────────────────
exports.onGiftCreated = onDocumentCreated('gifts/{giftId}', async (event) => {
  const gift = event.data.data();
  if (!gift) return;

  const token    = await getToken(gift.toUid);
  const fromName = gift.fromName   || 'Alguém';
  const fromAv   = gift.fromAvatar || '🌸';
  const giftEmoji = gift.gift      || '🎁';

  await sendPush(
    token,
    `${giftEmoji} Você recebeu um presente!`,
    `${fromAv} ${fromName} te enviou ${giftEmoji}`,
    { type: 'gift', giftId: event.params.giftId }
  );
});

// ── 6. Mensagem recebida ──────────────────────────────────────────────────────
exports.onMessageCreated = onDocumentCreated('messages/{msgId}', async (event) => {
  const msg = event.data.data();
  if (!msg) return;

  const token    = await getToken(msg.toUid);
  const fromName = msg.fromName   || 'Alguém';
  const fromAv   = msg.fromAvatar || '🌸';
  // Truncar texto longo para a notificação
  const preview  = (msg.text || '').slice(0, 80) + ((msg.text || '').length > 80 ? '…' : '');

  await sendPush(
    token,
    `💌 ${fromAv} ${fromName} te enviou uma mensagem`,
    preview,
    { type: 'message', msgId: event.params.msgId }
  );
});
