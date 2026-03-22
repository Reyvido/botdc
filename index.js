const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus
} = require('@discordjs/voice');
const play = require('play-dl');

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

// 🔥 CONNECT FUNCTION (ANTI BUG)
async function connectToChannel(vc) {
  connection = joinVoiceChannel({
    channelId: vc.id,
    guildId: vc.guild.id,
    adapterCreator: vc.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    connection.subscribe(player);
    console.log('Voice ready 🔊');
  } catch (error) {
    console.log('Gagal connect:', error);
    connection.destroy();
  }
}

// 🎵 PLAY FUNCTION
async function playMusic(url) {
  try {
    isPlaying = true;

    const stream = await play.stream(url);

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true,
    });

    resource.volume.setVolume(0.5);

    player.play(resource);

  } catch (err) {
    console.log('Play error:', err);
    isPlaying = false;
  }
}

// 🔁 LOOP
player.on(AudioPlayerStatus.Idle, async () => {
  if (queue.length > 0) {
    const next = queue.shift();
    await playMusic(next);
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
    if (!vc) return message.reply('Masuk voice dulu bre');
    await connectToChannel(vc);
    return message.reply('Masuk voice 😎');
  }

  // PLAY
  if (command === 'play') {
    const query = args.join(' ');
    if (!query) return message.reply('Masukin judul / link bre');
    if (!vc) return message.reply('Masuk voice dulu bre');

    if (!connection) {
      await connectToChannel(vc);
    }

    let url;

    try {
      if (play.is_spotify_url(query)) {
        const spData = await play.spotify(query);
        const yt = await play.search(`${spData.name} ${spData.artists[0].name}`, { limit: 1 });
        url = yt[0].url;
      } else {
        if (play.yt_validate(query) === 'video') {
          url = query;
        } else {
          const yt = await play.search(query, { limit: 1 });
          url = yt[0].url;
        }
      }

      if (isPlaying) {
        queue.push(url);
        return message.reply('Ditambah ke queue 🎶');
      }

      await playMusic(url);
      return message.reply('Gas muter lagu 🔊');

    } catch (err) {
      console.log(err);
      return message.reply('Error play ❌');
    }
  }

  // 24/7
  if (command === '247') {
    if (!vc) return message.reply('Masuk voice dulu bre');

    mode247 = !mode247;

    if (mode247) {
      if (!connection) {
        await connectToChannel(vc);
      }

      if (!isPlaying) {
        await playMusic(DEFAULT_URL);
      }

      return message.reply('Mode 24/7 ON 🔥');
    } else {
      return message.reply('Mode 24/7 OFF ❌');
    }
  }

  // LEAVE
  if (command === 'leave') {
    if (!connection) return message.reply('Bot ga lagi di voice');

    connection.destroy();
    connection = null;
    queue = [];
    isPlaying = false;
    mode247 = false;

    return message.reply('Cabut 👋');
  }
});

// LOGIN
client.login(process.env.TOKEN);