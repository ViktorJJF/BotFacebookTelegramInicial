process.env.NTBA_FIX_319 = 1;
const TelegramBot = require("node-telegram-bot-api");
const validator = require("validator");
const uuid = require("uuid");
const { structProtoToJson } = require("../helpers/structFunctions");
const dialogflow = require("../dialogflow");
const config = require("../config");

// replace the value below with the Telegram token you receive from @BotFather
const token = config.TELEGRAMTOKEN;

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, {
  polling: true,
});

const sessionIds = new Map();

async function setSessionAndUser(senderId) {
  try {
    if (!sessionIds.has(senderId)) {
      sessionIds.set(senderId, uuid.v1());
    }
  } catch (error) {
    throw error;
  }
}

bot.on("callback_query", async (action) => {
  let actionData = action.data;
  let senderId = action.from.id;
  try {
    // get option text
    let msg = "";
    let inlineOptions = action.message.reply_markup.inline_keyboard;
    for (const rowOptions of inlineOptions) {
      for (const option of rowOptions) {
        if (actionData === option.callback_data) msg = option.text;
      }
    }
    await sendTextMessage(senderId, `<b>Seleccionaste:</> ${msg}`);
    await sendToDialogFlow(senderId, actionData);
  } catch (error) {
    console.log("algo salio mal...", error);
  }
});

// Listen for any kind of message. There are different kinds of
// messages.
bot.on("message", async (msg) => {
  const senderId = msg.from.id;
  const message = msg.text;
  const userInfo = msg.from;
  // check if user was registered
  console.log("SE RECIBIO ESTE MENSAJE: ", message);
  try {
    if (message) {
      await sendToDialogFlow(senderId, message);
    } else {
      handleMessageAttachments(senderId);
    }
  } catch (error) {
    console.log(error);
  }
});

function handleMessageAttachments(senderId) {
  // for now just reply
  sendTextMessage(senderId, "Aún no entiendo ese tipo de mensajes");
}

async function handleDialogFlowResponse(sender, response) {
  let responseText = response.fulfillmentMessages.fulfillmentText;
  let messages = response.fulfillmentMessages;
  let { action } = response;
  let contexts = response.outputContexts;
  let { parameters } = response;

  if (isDefined(action)) {
    handleDialogFlowAction(sender, action, messages, contexts, parameters);
  } else if (isDefined(messages)) {
    handleMessages(messages, sender);
  } else if (responseText === "" && !isDefined(action)) {
    // dialogflow could not evaluate input.
    sendTextMessage(sender, "No estoy seguro de lo que deseas...");
  } else if (isDefined(responseText)) {
    sendTextMessage(sender, responseText);
  }
}

async function handleDialogFlowAction(
  senderId,
  action,
  messages,
  contexts,
  parameters
) {
  switch (action) {
    default:
      handleMessages(messages, senderId);
      break;
  }
}

async function sendToDialogFlow(senderId, messageText) {
  sendTypingOn(senderId);
  try {
    let result;
    setSessionAndUser(senderId);
    let session = sessionIds.get(senderId);
    result = await dialogflow.sendToDialogFlow(
      messageText,
      session,
      "TELEGRAM"
    );
    // }

    handleDialogFlowResponse(senderId, result);
  } catch (error) {
    console.log("salio mal en sendToDialogflow...", error);
  }
}

function sendTypingOn(senderId) {
  bot.sendChatAction(senderId, "typing");
}

async function handleMessage(message, sender) {
  switch (message.message) {
    case "text": // text
      for (const text of message.text.text) {
        if (text !== "") {
          await sendTextMessage(sender, text);
        }
      }
      break;
    case "quickReplies": // quick replies
      let { title } = message.quickReplies;
      let replies = [];
      message.quickReplies.quickReplies.forEach((text) => {
        replies.push({
          text,
          callback_data: text,
        });
      });
      await sendQuickReply(sender, title, replies);
      break;
    case "image": // image
      await sendImageMessage(sender, message.image.imageUri);
      break;
    case "payload":
      await handleDialogflowPayload(sender, message.payload);
      break;
    default:
      break;
  }
}

function handleDialogflowPayload(senderId, payload) {
  let desestructPayload = structProtoToJson(payload);
  let type = desestructPayload.telegram.attachment.payload.template_type;
  switch (type) {
    case "button":
      let { text } = desestructPayload.telegram.attachment.payload;
      let { buttons } = desestructPayload.telegram.attachment.payload;
      let formattedButtons = [];
      buttons.forEach((button) => {
        formattedButtons.push({
          text: button.title,
          url: button.url,
        });
      });
      sendButtons(senderId, text, formattedButtons);
      break;

    default:
      console.log("el tipo de payload no se reconoce...");
      break;
  }
}

async function sendButtons(senderId, title, buttons) {
  buttons = buttons.map((button) => {
    if (validator.isEmpty(button.callback_data)) {
      button.callback_data = button.text;
    }
    return [button];
  });

  await bot.sendMessage(senderId, title, {
    reply_markup: {
      inline_keyboard: buttons,
      resize_keyboard: true,
    },
    parse_mode: "HTML",
  });
}

async function sendQuickReply(senderId, title, replies) {
  await bot.sendMessage(senderId, title, {
    parse_mode: "html",
    reply_markup: {
      inline_keyboard: [replies],
      resize_keyboard: true,
    },
  });
}

async function sendImageMessage(senderId, url) {
  if (validator.isURL(url)) {
    await bot.sendChatAction(senderId, "upload_photo");
    await bot.sendPhoto(senderId, url);
  }
}

async function handleMessages(messages, sender) {
  for (let i = 0; i < messages.length; i++) {
    switch (messages[i].message) {
      case "card":
        await handleCardMessages([messages[i]], sender);
        break;
      case "text":
        await handleMessage(messages[i], sender);
        break;
      case "image":
        await handleMessage(messages[i], sender);
        break;
      case "quickReplies":
        await handleMessage(messages[i], sender);
        break;
      default:
        break;
    }
    await timeout(500);
  }
}

async function timeout(millis) {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, millis);
  });
}

async function handleCardMessages(messages, senderId) {
  for (let m = 0; m < messages.length; m++) {
    let message = messages[m];
    let buttons = [];
    for (let b = 0; b < message.card.buttons.length; b++) {
      let isLink = message.card.buttons[b].postback.substring(0, 4) === "http";
      let button;
      if (isLink) {
        button = {
          text: message.card.buttons[b].text,
          url: message.card.buttons[b].postback,
        };
      } else {
        button = {
          text: message.card.buttons[b].text,
          callback_data: message.card.buttons[b].postback,
        };
      }
      buttons.push(button);
    }

    let element = {
      title: message.card.title,
      image_url: message.card.imageUri,
      subtitle: message.card.subtitle || " ",
      buttons,
    };
    await sendGenericMessage(senderId, element);
  }
}

async function sendGenericMessage(senderId, element) {
  await sendImageMessage(senderId, element.image_url);
  // await sendTextMessage(senderId, `<b>${element.title}</b>`);
  await sendButtons(
    senderId,
    `<b>${element.title}</b>` + `\n${element.subtitle}`,
    element.buttons
  );
}

async function sendTextMessage(senderId, message) {
  // send message
  await bot.sendMessage(senderId, message, {
    parse_mode: "HTML",
  });
}

function isDefined(obj) {
  if (typeof obj === "undefined") {
    return false;
  }

  if (!obj) {
    return false;
  }
  if (obj === "") {
    return false;
  }
  return obj != null;
}
