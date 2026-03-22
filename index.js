const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
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
const DEFAULT_URL = "https://www.youtube.com/watch?v=jfKfPfyJRdk"; // lofi

// 🔥 BOT READY
client.once('ready', () => {
  console.log(`Bot nyala: ${client.user.tag}`);
});

// 🔥 PLAY FUNCTION
async function playMusic(url) {
  try {
    isPlaying = true;

    const stream = await play.stream(url);
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    player.play(resource);
  } catch (err) {
    console.log('Error play:', err);
    isPlaying = false;
  }
}

// 🔁 QUEUE & 24/7 SYSTEM
player.on(AudioPlayerStatus.Idle, async () => {
  try {
    if (queue.length > 0) {
      const next = queue.shift();
      await playMusic(next);
    } else if (mode247) {
      await playMusic(DEFAULT_URL);
    } else {
      isPlaying = false;
    }
  } catch (e) {
    console.log(e);
  }
});

// 🎮 PREFIX COMMAND SYSTEM
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  const vc = message.member.voice.channel;

  // 🔊 JOIN
  if (command === 'join') {
    if (!vc) return message.reply('Masuk voice dulu bre');

    connection = joinVoiceChannel({
      channelId: vc.id,
      guildId: vc.guild.id,
      adapterCreator: vc.guild.voiceAdapterCreator,
    });

    connection.subscribe(player);

    return message.reply('Masuk voice 😎');
  }

  // 🎵 PLAY
  if (command === 'play') {
    const query = args.join(' ');
    if (!query) return message.reply('Masukin judul / link bre');
    if (!vc) return message.reply('Masuk voice dulu bre');

    if (!connection) {
      connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: vc.guild.id,
        adapterCreator: vc.guild.voiceAdapterCreator,
      });
      connection.subscribe(player);
    }

    let url;

    try {
      // 🔥 SPOTIFY
      if (play.is_spotify_url(query)) {
        const spData = await play.spotify(query);

        if (spData.type === 'track') {
          const yt = await play.search(`${spData.name} ${spData.artists[0].name}`, { limit: 1 });
          url = yt[0].url;
        }

        if (spData.type === 'playlist') {
          const tracks = await spData.all_tracks();

          message.reply(`Playlist (${tracks.length} lagu) masuk queue 🔥`);

          for (let track of tracks) {
            const yt = await play.search(`${track.name} ${track.artists[0].name}`, { limit: 1 });
            queue.push(yt[0].url);
          }

          if (!isPlaying) {
            const next = queue.shift();
            await playMusic(next);
          }
          return;
        }

      } else {
        // 🔥 YOUTUBE / SEARCH
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
      return message.reply('Error pas play lagu ❌');
    }
  }

  // ⏭️ SKIP
  if (command === 'skip') {
    player.stop();
    return message.reply('Skip ⏭️');
  }

  // ⛔ STOP
  if (command === 'stop') {
    queue = [];
    player.stop();
    isPlaying = false;
    return message.reply('Stop semua ❌');
  }

  // 🔁 24/7 MODE
  if (command === '247') {
    mode247 = !mode247;

    if (mode247 && !isPlaying) {
      await playMusic(DEFAULT_URL);
    }

    return message.reply(`Mode 24/7: ${mode247 ? 'ON 🔥' : 'OFF ❌'}`);
  }
  
  // 🚪 LEAVE / DISCONNECT
if (command === 'leave') {
  if (!connection) return message.reply('Bot ga lagi di voice bre');

  try {
    connection.destroy();
    connection = null;

    queue = [];
    isPlaying = false;
    mode247 = false;

    return message.reply('Cabut dari voice 👋');
  } catch (err) {
    console.log(err);
    return message.reply('Error pas keluar voice ❌');
  }
});

// 🔐 LOGIN (AMAN)
client.login(process.env.TOKEN);