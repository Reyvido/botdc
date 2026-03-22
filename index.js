const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
} = require('@discordjs/voice');
const play = require('play-dl');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

let connection;
let player = createAudioPlayer();
let queue = [];
let isPlaying = false;
let mode247 = false;

const DEFAULT_URL = "https://www.youtube.com/watch?v=jfKfPfyJRdk"; // lofi

client.once('ready', async () => {
  console.log(`Bot nyala: ${client.user.tag}`);
});

// 🔥 PLAY FUNCTION
async function playMusic(url) {
  isPlaying = true;

  const stream = await play.stream(url);
  const resource = createAudioResource(stream.stream, {
    inputType: stream.type,
  });

  player.play(resource);
}

// 🔁 LOOP & QUEUE SYSTEM
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

// 🎮 COMMANDS
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const vc = interaction.member.voice.channel;

  // JOIN
  if (interaction.commandName === 'join') {
    if (!vc) return interaction.reply('Masuk voice dulu bre');

    connection = joinVoiceChannel({
      channelId: vc.id,
      guildId: vc.guild.id,
      adapterCreator: vc.guild.voiceAdapterCreator,
    });

    connection.subscribe(player);

    return interaction.reply('Masuk voice 😎');
  }

  // PLAY
  if (interaction.commandName === 'play') {
    const query = interaction.options.getString('url');

    if (!vc) return interaction.reply('Masuk voice dulu bre');

    if (!connection) {
      connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: vc.guild.id,
        adapterCreator: vc.guild.voiceAdapterCreator,
      });
      connection.subscribe(player);
    }

    let url;

    // 🔥 SPOTIFY
    if (play.is_spotify_url(query)) {
      const spData = await play.spotify(query);

      if (spData.type === 'track') {
        const yt = await play.search(`${spData.name} ${spData.artists[0].name}`, { limit: 1 });
        url = yt[0].url;
      }

      if (spData.type === 'playlist') {
        const tracks = await spData.all_tracks();

        interaction.reply(`Playlist (${tracks.length} lagu) ditambah ke queue 🔥`);

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
      // 🔥 YT / SEARCH
      if (play.yt_validate(query) === 'video') {
        url = query;
      } else {
        const yt = await play.search(query, { limit: 1 });
        url = yt[0].url;
      }
    }

    if (isPlaying) {
      queue.push(url);
      return interaction.reply('Ditambah ke queue 🎶');
    }

    await playMusic(url);
    return interaction.reply('Gas muter lagu 🔊');
  }

  // SKIP
  if (interaction.commandName === 'skip') {
    player.stop();
    return interaction.reply('Skip ⏭️');
  }

  // STOP
  if (interaction.commandName === 'stop') {
    queue = [];
    player.stop();
    isPlaying = false;
    return interaction.reply('Stop semua ❌');
  }

  // 24/7 MODE
  if (interaction.commandName === '247') {
    mode247 = !mode247;

    if (mode247 && !isPlaying) {
      await playMusic(DEFAULT_URL);
    }

    return interaction.reply(`Mode 24/7: ${mode247 ? 'ON 🔥' : 'OFF ❌'}`);
  }
});

client.login(process.env.TOKEN);
