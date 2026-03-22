const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus
} = require('@discordjs/voice');
const ytdl = require('ytdl-core');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let connection;
let player = createAudioPlayer();
let queue = [];
let isPlaying = false;
let mode247 = false;

const PREFIX = 'k!';
const DEFAULT_URL = "https://www.youtube.com/watch?v=jfKfPfyJRdk";

// READY
client.once('ready', () => {
  console.log(`Bot nyala: ${client.user.tag}`);
});

// CONNECT
async function connect(vc) {
  connection = joinVoiceChannel({
    channelId: vc.id,
    guildId: vc.guild.id,
    adapterCreator: vc.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 20000);
  connection.subscribe(player);
}

// PLAY
async function playMusic(url) {
  try {
    isPlaying = true;

    const stream = ytdl(url, {
      filter: 'audioonly',
      quality: 'highestaudio'
    });

    const resource = createAudioResource(stream);

    player.play(resource);

  } catch (err) {
    console.log(err);
    isPlaying = false;
  }
}

// LOOP
player.on(AudioPlayerStatus.Idle, async () => {
  if (queue.length > 0) {
    await playMusic(queue.shift());
  } else if (mode247) {
    await playMusic(DEFAULT_URL);
  } else {
    isPlaying = false;
  }
});

// COMMAND
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const vc = message.member.voice.channel;

  // JOIN
  if (command === 'join') {
    if (!vc) return message.reply('Masuk voice dulu');
    await connect(vc);
    return message.reply('Join voice');
  }

  // PLAY (YT ONLY FIX)
  if (command === 'play') {
    const url = args[0];
    if (!url) return message.reply('Masukin link YouTube');

    if (!ytdl.validateURL(url)) {
      return message.reply('Link harus YouTube dulu bre (sementara)');
    }

    if (!connection) await connect(vc);

    if (isPlaying) {
      queue.push(url);
      return message.reply('Masuk queue');
    }

    await playMusic(url);
    return message.reply('Play 🔊');
  }

  // 24/7
  if (command === '247') {
    if (!vc) return message.reply('Masuk voice dulu');

    mode247 = !mode247;

    if (mode247) {
      if (!connection) await connect(vc);
      if (!isPlaying) await playMusic(DEFAULT_URL);
      return message.reply('24/7 ON 🔥');
    } else {
      return message.reply('24/7 OFF');
    }
  }

  // LEAVE
  if (command === 'leave') {
    if (!connection) return message.reply('Ga di voice');

    connection.destroy();
    connection = null;
    queue = [];
    isPlaying = false;
    mode247 = false;

    return message.reply('Leave 👋');
  }
});

client.login(process.env.TOKEN);