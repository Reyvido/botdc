const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
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
let currentSong = null;
let isPlaying = false;
let mode247 = false;
let manualLeave = false; // flag buat bedain leave manual vs disconnect paksa

const PREFIX = 'k!';
const DEFAULT_URL = "https://www.youtube.com/watch?v=jfKfPfyJRdk";

// ─────────────────────────────────────────
// HELPER: resolve input → YouTube URL + info
// ─────────────────────────────────────────
async function resolveInput(input) {
  const type = await playdl.validate(input);

  if (type === 'yt_video') {
    const info = await playdl.video_info(input);
    return [{
      title: info.video_details.title,
      url: info.video_details.url,
      thumbnail: info.video_details.thumbnails?.[0]?.url || null,
      duration: formatDuration(info.video_details.durationInSec),
    }];
  }

  if (type === 'yt_playlist') {
    const playlist = await playdl.playlist_info(input, { incomplete: true });
    const videos = await playlist.all_videos();
    return videos.map(v => ({
      title: v.title,
      url: v.url,
      thumbnail: v.thumbnails?.[0]?.url || null,
      duration: formatDuration(v.durationInSec),
    }));
  }

  if (type === 'sp_track') {
    const spData = await playdl.spotify(input);
    const query = `${spData.name} ${spData.artists.map(a => a.name).join(' ')}`;
    const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
    if (!results.length) throw new Error('Lagu Spotify ga ketemu di YouTube');
    return [{
      title: results[0].title,
      url: results[0].url,
      thumbnail: results[0].thumbnails?.[0]?.url || null,
      duration: formatDuration(results[0].durationInSec),
    }];
  }

  if (type === 'sp_album' || type === 'sp_playlist') {
    const spData = await playdl.spotify(input);
    const tracks = spData.fetched_tracks?.get('1') || [];
    const resolved = [];
    for (const track of tracks.slice(0, 50)) {
      const query = `${track.name} ${track.artists.map(a => a.name).join(' ')}`;
      const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
      if (results.length) {
        resolved.push({
          title: results[0].title,
          url: results[0].url,
          thumbnail: results[0].thumbnails?.[0]?.url || null,
          duration: formatDuration(results[0].durationInSec),
        });
      }
    }
    return resolved;
  }

  // Nama lagu / search query
  const results = await playdl.search(input, { source: { youtube: 'video' }, limit: 1 });
  if (!results.length) throw new Error('Lagu ga ketemu bro');
  return [{
    title: results[0].title,
    url: results[0].url,
    thumbnail: results[0].thumbnails?.[0]?.url || null,
    duration: formatDuration(results[0].durationInSec),
  }];
}

function formatDuration(sec) {
  if (!sec) return '??:??';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─────────────────────────────────────────
// CONNECT - dengan reconnect loop agresif
// ─────────────────────────────────────────
async function connect(vc) {
  manualLeave = false;

  connection = joinVoiceChannel({
    channelId: vc.id,
    guildId: vc.guild.id,
    adapterCreator: vc.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 20000);
  connection.subscribe(player);

  // ── KUNCI UTAMA: jangan pernah keluar kecuali manualLeave = true ──
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    // Kalau memang disuruh keluar, biarkan
    if (manualLeave) return;

    // Coba reconnect dulu (Discord kadang disconnect sebentar)
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
      // Berhasil reconnect, lanjut
    } catch {
      // Gagal reconnect otomatis → paksa rejoin ulang
      console.log('Disconnect terdeteksi, rejoin ulang...');
      if (!manualLeave && vc) {
        try {
          connection.destroy();
        } catch {}
        // Tunggu bentar lalu rejoin
        setTimeout(async () => {
          if (!manualLeave) {
            await connect(vc);
            // Kalau mode 247 aktif dan ga ada yang main, mulai lagi
            if (mode247 && !isPlaying) {
              await playMusic({ title: 'lofi hip hop radio', url: DEFAULT_URL, duration: '∞' });
            }
          }
        }, 3000);
      }
    }
  });

  // Kalau tiba-tiba Destroyed dari luar (misal bot di-kick dari VC)
  connection.on(VoiceConnectionStatus.Destroyed, async () => {
    if (manualLeave) return;

    // Bot di-kick / channel dihapus → coba rejoin
    console.log('Connection destroyed, coba rejoin...');
    setTimeout(async () => {
      if (!manualLeave && vc) {
        try {
          await connect(vc);
          if (mode247 && !isPlaying) {
            await playMusic({ title: 'lofi hip hop radio', url: DEFAULT_URL, duration: '∞' });
          }
        } catch (err) {
          console.error('Gagal rejoin:', err.message);
        }
      }
    }, 5000);
  });
}

// ─────────────────────────────────────────
// PLAY
// ─────────────────────────────────────────
async function playMusic(songObj) {
  try {
    isPlaying = true;
    currentSong = songObj;

    const source = await playdl.stream(songObj.url, { quality: 2 });
    const resource = createAudioResource(source.stream, {
      inputType: source.type,
    });

    player.play(resource);
  } catch (err) {
    console.error('Error playMusic:', err);
    isPlaying = false;
    currentSong = null;
  }
}

// ─────────────────────────────────────────
// IDLE → next queue / 24/7 loop
// ─────────────────────────────────────────
player.on(AudioPlayerStatus.Idle, async () => {
  isPlaying = false;
  currentSong = null;
  if (queue.length > 0) {
    await playMusic(queue.shift());
  } else if (mode247) {
    await playMusic({ title: 'lofi hip hop radio', url: DEFAULT_URL, duration: '∞' });
  }
});

player.on('error', (err) => {
  console.error('Player error:', err.message);
  isPlaying = false;
  currentSong = null;
  if (mode247) {
    setTimeout(() => playMusic({ title: 'lofi hip hop radio', url: DEFAULT_URL, duration: '∞' }), 3000);
  }
});

// ─────────────────────────────────────────
// READY
// ─────────────────────────────────────────
client.once('ready', () => {
  console.log(`Bot nyala: ${client.user.tag}`);
  client.user.setActivity('k!help | 🎵 Music', { type: 2 });
});

// ─────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const vc = message.member?.voice?.channel;

  // ── HELP ──
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎵 Bot Music Commands')
      .setDescription('Prefix: `k!`')
      .addFields(
        { name: '`k!play <judul / link YT / link Spotify>`', value: 'Putar lagu — bisa nama lagu, link YouTube, atau link Spotify' },
        { name: '`k!search <judul>`', value: 'Cari lagu dan lihat 5 hasil teratas' },
        { name: '`k!skip`', value: 'Skip lagu yang lagi main' },
        { name: '`k!queue` / `k!q`', value: 'Lihat antrian lagu' },
        { name: '`k!nowplaying` / `k!np`', value: 'Lihat lagu yang lagi main' },
        { name: '`k!247`', value: 'Toggle mode 24/7 — bot ga akan keluar VC sampai `k!leave`' },
        { name: '`k!join`', value: 'Bot masuk voice channel' },
        { name: '`k!leave`', value: '⚠️ Satu-satunya cara keluarin bot dari VC' },
      )
      .setFooter({ text: 'Support: Nama lagu • YouTube link • Spotify track/album/playlist' });
    return message.reply({ embeds: [embed] });
  }

  // ── JOIN ──
  if (command === 'join') {
    if (!vc) return message.reply('Masuk voice dulu bro');
    await connect(vc);
    return message.reply('Join voice ✅');
  }

  // ── PLAY ──
  if (command === 'play') {
    const input = args.join(' ');
    if (!input) return message.reply('Masukin judul lagu, link YouTube, atau link Spotify bro');
    if (!vc) return message.reply('Masuk voice dulu bro');

    const loading = await message.reply('🔍 Nyari lagu...');

    try {
      const songs = await resolveInput(input);
      if (!connection) await connect(vc);

      if (songs.length === 1) {
        const song = { ...songs[0], requestedBy: message.author.username };

        if (isPlaying) {
          queue.push(song);
          const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('➕ Masuk Queue')
            .setDescription(`**[${song.title}](${song.url})**`)
            .addFields(
              { name: 'Durasi', value: song.duration, inline: true },
              { name: 'Posisi', value: `#${queue.length}`, inline: true },
              { name: 'Request by', value: song.requestedBy, inline: true }
            )
            .setThumbnail(song.thumbnail);
          return loading.edit({ content: '', embeds: [embed] });
        }

        await playMusic(song);
        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('▶️ Now Playing')
          .setDescription(`**[${song.title}](${song.url})**`)
          .addFields(
            { name: 'Durasi', value: song.duration, inline: true },
            { name: 'Request by', value: song.requestedBy, inline: true }
          )
          .setThumbnail(song.thumbnail);
        return loading.edit({ content: '', embeds: [embed] });

      } else {
        const songsWithReq = songs.map(s => ({ ...s, requestedBy: message.author.username }));
        if (!isPlaying) {
          await playMusic(songsWithReq.shift());
          queue.push(...songsWithReq);
        } else {
          queue.push(...songsWithReq);
        }

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📋 Playlist / Album Ditambahkan')
          .setDescription(`**${songs.length} lagu** berhasil masuk queue`)
          .addFields({ name: 'Request by', value: message.author.username });
        return loading.edit({ content: '', embeds: [embed] });
      }

    } catch (err) {
      console.error(err);
      return loading.edit(`❌ Error: ${err.message}`);
    }
  }

  // ── SEARCH ──
  if (command === 'search') {
    const query = args.join(' ');
    if (!query) return message.reply('Masukin judul lagu bro');

    const loading = await message.reply('🔍 Nyari lagu...');

    try {
      const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 5 });
      if (!results.length) return loading.edit('❌ Lagu ga ketemu bro');

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🔍 Hasil pencarian: "${query}"`)
        .setDescription(
          results.map((v, i) =>
            `**${i + 1}.** [${v.title}](${v.url}) — \`${formatDuration(v.durationInSec)}\``
          ).join('\n')
        )
        .setFooter({ text: 'Gunakan k!play <judul atau link> buat putar lagunya' });

      return loading.edit({ content: '', embeds: [embed] });

    } catch (err) {
      return loading.edit(`❌ Error: ${err.message}`);
    }
  }

  // ── SKIP ──
  if (command === 'skip') {
    if (!isPlaying) return message.reply('Ga ada lagu yang lagi main bro');
    player.stop();
    return message.reply('⏭️ Skip!');
  }

  // ── QUEUE ──
  if (command === 'queue' || command === 'q') {
    if (!currentSong && queue.length === 0) return message.reply('Queue kosong bro');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📋 Queue');

    if (currentSong) {
      embed.addFields({
        name: '▶️ Now Playing',
        value: `[${currentSong.title}](${currentSong.url}) — \`${currentSong.duration}\``
      });
    }

    if (queue.length > 0) {
      const list = queue.slice(0, 10).map((s, i) =>
        `**${i + 1}.** [${s.title}](${s.url}) — \`${s.duration}\``
      ).join('\n');
      embed.addFields({ name: `📋 Next Up (${queue.length} lagu)`, value: list });
      if (queue.length > 10) embed.setFooter({ text: `+ ${queue.length - 10} lagu lagi...` });
    }

    return message.reply({ embeds: [embed] });
  }

  // ── NOW PLAYING ──
  if (command === 'nowplaying' || command === 'np') {
    if (!currentSong) return message.reply('Ga ada lagu yang lagi main bro');

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('▶️ Now Playing')
      .setDescription(`**[${currentSong.title}](${currentSong.url})**`)
      .addFields(
        { name: 'Durasi', value: currentSong.duration, inline: true },
        { name: 'Request by', value: currentSong.requestedBy || 'Unknown', inline: true }
      )
      .setThumbnail(currentSong.thumbnail);

    return message.reply({ embeds: [embed] });
  }

  // ── 24/7 ──
  if (command === '247') {
    if (!vc) return message.reply('Masuk voice dulu bro');
    mode247 = !mode247;
    if (mode247) {
      if (!connection) await connect(vc);
      if (!isPlaying) await playMusic({ title: 'lofi hip hop radio', url: DEFAULT_URL, duration: '∞' });
      return message.reply('24/7 ON 🔥 Bot ga akan keluar VC sampai `k!leave`');
    } else {
      return message.reply('24/7 OFF 😴 Bot akan keluar kalau queue habis');
    }
  }

  // ── LEAVE (satu-satunya cara keluarin bot) ──
  if (command === 'leave') {
    if (!connection) return message.reply('Ga di voice bro');
    manualLeave = true; // tandai ini intentional
    connection.destroy();
    connection = null;
    queue = [];
    currentSong = null;
    isPlaying = false;
    mode247 = false;
    player.stop();
    return message.reply('Leave 👋');
  }
});

client.login(process.env.TOKEN);
