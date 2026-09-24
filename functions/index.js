const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const TOWA_ADMIN_KEY = defineSecret("TOWA_ADMIN_KEY");

const db = getFirestore();

const OWNER_EMAIL = "flowersonickmer87@gmail.com";

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function authorized(req) {
  const header = req.get("Authorization") || "";
  const key = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  return key && key === TOWA_ADMIN_KEY.value();
}

async function findUser(username) {
  const usernameClean = String(username || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();

  if (!usernameClean) {
    throw new Error("Не указан username");
  }

  const snap = await db
    .collection("usernames")
    .doc(usernameClean)
    .get();

  if (!snap.exists) {
    throw new Error("Пользователь не найден");
  }

  const data = snap.data();

  return {
    uid: data.uid,
    username: data.username || usernameClean
  };
}

exports.towaAdmin = onRequest(
  {
    cors: true,
    secrets: [TOWA_ADMIN_KEY],
    region: "us-central1"
  },
  async (req, res) => {

    cors(res);

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Используй POST"
      });
    }

    try {

      // =========================
      // ПРОВЕРКА КЛЮЧА
      // =========================

      if (!authorized(req)) {
        return res.status(401).json({
          error: "Доступ запрещён"
        });
      }

      const body = req.body || {};
      const action = body.action;

      // =========================
      // FIND USER
      // =========================

      if (action === "findUser") {

        const user = await findUser(body.username);

        const userDoc = await db
          .collection("users")
          .doc(user.uid)
          .get();

        return res.json({
          ok: true,
          user: {
            uid: user.uid,
            username: user.username,
            ...(userDoc.exists ? userDoc.data() : {})
          }
        });
      }

      // =========================
      // BAN USER
      // =========================

      if (action === "banUser") {

        const user = await findUser(body.username);

        const reason = String(body.reason || "Нарушение правил");

        let bannedUntil = null;

        if (body.durationMinutes) {
          const minutes = Number(body.durationMinutes);

          if (!Number.isFinite(minutes) || minutes <= 0) {
            throw new Error("Неверная длительность бана");
          }

          bannedUntil = new Date(
            Date.now() + minutes * 60 * 1000
          );
        }

        await db.collection("users").doc(user.uid).set({
          banned: true,
          banReason: reason,
          bannedUntil: bannedUntil
            ? bannedUntil
            : null,
          bannedAt: FieldValue.serverTimestamp(),
          bannedBy: OWNER_EMAIL
        }, {
          merge: true
        });

        return res.json({
          ok: true,
          action: "banUser",
          username: user.username,
          uid: user.uid,
          bannedUntil
        });
      }

      // =========================
      // UNBAN USER
      // =========================

      if (action === "unbanUser") {

        const user = await findUser(body.username);

        await db.collection("users").doc(user.uid).set({
          banned: false,
          banReason: "",
          bannedUntil: null,
          unbannedAt: FieldValue.serverTimestamp(),
          unbannedBy: OWNER_EMAIL
        }, {
          merge: true
        });

        return res.json({
          ok: true,
          action: "unbanUser",
          username: user.username,
          uid: user.uid
        });
      }

      // =========================
      // ADD FIRE
      // =========================

      if (action === "addFire") {

        const user = await findUser(body.username);

        const amount = Number(body.amount);

        if (!Number.isFinite(amount) || amount === 0) {
          throw new Error("Неверное количество 🔥");
        }

        await db.collection("users").doc(user.uid).update({
          fire: FieldValue.increment(amount)
        });

        return res.json({
          ok: true,
          action: "addFire",
          username: user.username,
          amount
        });
      }

      // =========================
      // CREATE GIFT
      // =========================

      if (action === "createGift") {

        const name = String(body.name || "").trim();
        const emoji = String(body.emoji || "🎁");
        const price = Number(body.price);
        const photoUrl = String(body.photoUrl || "");

        if (!name) {
          throw new Error("Не указано название подарка");
        }

        if (!Number.isFinite(price) || price < 1) {
          throw new Error("Неверная цена");
        }

        const ref = await db.collection("shop").add({
          name,
          emoji,
          price,
          photoUrl,
          active: true,
          createdBy: OWNER_EMAIL,
          createdAt: FieldValue.serverTimestamp()
        });

        return res.json({
          ok: true,
          action: "createGift",
          giftId: ref.id,
          name,
          emoji,
          price
        });
      }

      // =========================
      // DELETE GIFT
      // =========================

      if (action === "deleteGift") {

        const giftId = String(body.giftId || "");

        if (!giftId) {
          throw new Error("Не указан giftId");
        }

        await db.collection("shop").doc(giftId).delete();

        return res.json({
          ok: true,
          action: "deleteGift",
          giftId
        });
      }

      // =========================
      // UPDATE GIFT
      // =========================

      if (action === "updateGift") {

        const giftId = String(body.giftId || "");

        if (!giftId) {
          throw new Error("Не указан giftId");
        }

        const update = {};

        if (body.name !== undefined) {
          update.name = String(body.name);
        }

        if (body.emoji !== undefined) {
          update.emoji = String(body.emoji);
        }

        if (body.price !== undefined) {
          const price = Number(body.price);

          if (!Number.isFinite(price) || price < 1) {
            throw new Error("Неверная цена");
          }

          update.price = price;
        }

        if (body.photoUrl !== undefined) {
          update.photoUrl = String(body.photoUrl);
        }

        if (body.active !== undefined) {
          update.active = Boolean(body.active);
        }

        update.updatedAt = FieldValue.serverTimestamp();

        await db.collection("shop").doc(giftId).update(update);

        return res.json({
          ok: true,
          action: "updateGift",
          giftId
        });
      }

      // =========================
      // SEND MESSAGE
      // =========================

      if (action === "sendMessage") {

        const user = await findUser(body.username);

        const text = String(body.text || "").trim();

        if (!text) {
          throw new Error("Пустое сообщение");
        }

        const chatId = String(body.chatId || "");

        if (!chatId) {
          throw new Error(
            "Для отправки сообщения нужен chatId"
          );
        }

        const chatRef = db.collection("chats").doc(chatId);

        const messageRef = chatRef
          .collection("messages")
          .doc();

        await messageRef.set({
          from: "towa_admin",
          nickname: "Towa Admin",
          avatar: "",
          text,
          photoUrl: "",
          read: false,
          createdAt: FieldValue.serverTimestamp()
        });

        await chatRef.set({
          lastMessage: text,
          lastMessageType: "text",
          lastFrom: "towa_admin",
          lastTime: FieldValue.serverTimestamp()
        }, {
          merge: true
        });

        return res.json({
          ok: true,
          action: "sendMessage",
          messageId: messageRef.id,
          username: user.username
        });
      }

      // =========================
      // UNKNOWN ACTION
      // =========================

      return res.status(400).json({
        error: "Неизвестная команда",
        availableActions: [
          "findUser",
          "banUser",
          "unbanUser",
          "addFire",
          "createGift",
          "updateGift",
          "deleteGift",
          "sendMessage"
        ]
      });

    } catch (error) {

      console.error(error);

      return res.status(400).json({
        ok: false,
        error: error.message || "Ошибка"
      });
    }
  }
);
