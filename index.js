const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
  StreamType
} = require('@discordjs/voice');
const playdl = require('play-dl');

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

  // Auto-reconnect kalau disconnect (penting buat 24/7)
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch {
      connection.destroy();
      connection = null;
    }
  });
}

// PLAY - pakai play-dl, bukan ytdl-core
async function playMusic(url) {
  try {
    isPlaying = true;

    // Ambil stream pakai play-dl
    const source = await playdl.stream(url, { quality: 2 });

    const resource = createAudioResource(source.stream, {
      inputType: source.type,  // <-- ini yang bikin suara keluar
    });

    player.play(resource);
  } catch (err) {
    console.error('Error playMusic:', err);
    isPlaying = false;
  }
}

// IDLE - lanjut queue atau loop 24/7
player.on(AudioPlayerStatus.Idle, async () => {
  isPlaying = false;
  if (queue.length > 0) {
    await playMusic(queue.shift());
  } else if (mode247) {
    await playMusic(DEFAULT_URL);
  }
});

// Error handling player biar ga crash
player.on('error', (err) => {
  console.error('Player error:', err.message);
  isPlaying = false;
  if (mode247) {
    setTimeout(() => playMusic(DEFAULT_URL), 3000);
  }
});

// COMMAND
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const vc = message.member?.voice?.channel;

  // JOIN
  if (command === 'join') {
    if (!vc) return message.reply('Masuk voice dulu bro');
    await connect(vc);
    return message.reply('Join voice ✅');
  }

  // PLAY
  if (command === 'play') {
    const url = args[0];
    if (!url) return message.reply('Masukin link YouTube bro');

    // Validasi URL pakai play-dl
    const urlType = await playdl.validate(url);
    if (!urlType || !urlType.toString().startsWith('yt')) {
      return message.reply('Link harus YouTube bro (sementara)');
    }

    if (!vc) return message.reply('Masuk voice dulu bro');
    if (!connection) await connect(vc);

    if (isPlaying) {
      queue.push(url);
      return message.reply(`Masuk queue (posisi: ${queue.length}) 🎵`);
    }

    await playMusic(url);
    return message.reply('Play 🔊');
  }

  // SKIP
  if (command === 'skip') {
    if (!isPlaying) return message.reply('Ga ada yang lagi main bro');
    player.stop(); // trigger Idle → next queue
    return message.reply('Skip ⏭️');
  }

  // QUEUE
  if (command === 'queue') {
    if (queue.length === 0) return message.reply('Queue kosong bro');
    const list = queue.map((url, i) => `${i + 1}. ${url}`).join('\n');
    return message.reply(`**Queue:**\n${list}`);
  }

  // 24/7
  if (command === '247') {
    if (!vc) return message.reply('Masuk voice dulu bro');
    mode247 = !mode247;
    if (mode247) {
      if (!connection) await connect(vc);
      if (!isPlaying) await playMusic(DEFAULT_URL);
      return message.reply('24/7 ON 🔥');
    } else {
      return message.reply('24/7 OFF 😴');
    }
  }

  // LEAVE
  if (command === 'leave') {
    if (!connection) return message.reply('Ga di voice bro');
    connection.destroy();
    connection = null;
    queue = [];
    isPlaying = false;
    mode247 = false;
    player.stop();
    return message.reply('Leave 👋');
  }
});

client.login(process.env.TOKEN);
