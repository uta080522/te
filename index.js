// index.js
const { Client, GatewayIntentBits, Events, ActivityType, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// --- 設定 ---
const DB_FILE = 'user_times.json';
const DB_PATH = path.join(__dirname, DB_FILE);
const SAVE_INTERVAL = 60 * 1000; // 1分

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

let userTimes = new Map();

// --- データ永続化のための関数 ---

function loadData() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            const parsedData = JSON.parse(data);
            userTimes = new Map(Object.entries(parsedData));
            for (const userData of userTimes.values()) {
                userData.joinTime = null;
            }
            console.log(`${DB_FILE} からデータを正常に読み込みました。`);
        } else {
            console.log(`${DB_FILE} が見つかりません。新しいデータファイルを作成します。`);
        }
    } catch (error) {
        console.error(`${DB_FILE} の読み込み中にエラーが発生しました:`, error);
    }
}

function saveData() {
    try {
        const dataToSave = new Map();
        for (const [userId, data] of userTimes.entries()) {
            let currentTotalTime = data.totalTime;
            if (data.joinTime) {
                currentTotalTime += Date.now() - data.joinTime;
            }
            dataToSave.set(userId, { totalTime: currentTotalTime, joinTime: null });
        }
        
        const dataObject = Object.fromEntries(dataToSave);
        // fs.writeFileSync を使用して同期的に書き込み、クラッシュ直前のデータ損失を防ぐ
        fs.writeFileSync(DB_PATH, JSON.stringify(dataObject, null, 2));
        // console.log(`データを ${DB_FILE} に保存しました。`); // 頻繁に呼ばれるのでログはコメントアウトしても良い
    } catch (error) {
        console.error(`${DB_FILE} への保存中にエラーが発生しました:`, error);
    }
}

// --- Botのイベントリスナー ---

client.once(Events.ClientReady, () => {
    console.log(`ログインしました: ${client.user.tag}`);
    loadData();
    setInterval(() => {
        updateStatus();
        saveData(); // 長時間接続しているユーザーのデータを定期的にバックアップ
    }, SAVE_INTERVAL);
    updateStatus();
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (newState.guild.id !== process.env.GUILD_ID || newState.member.user.bot) return;

    const userId = newState.id;
    if (!userTimes.has(userId)) {
        userTimes.set(userId, { totalTime: 0, joinTime: null });
    }
    const userData = userTimes.get(userId);

    const wasCountable = oldState.channelId && !oldState.serverMute && !oldState.selfMute;
    const isCountable = newState.channelId && !newState.serverMute && !newState.selfMute;

    if (wasCountable && !isCountable) {
        if (userData.joinTime) {
            const sessionTime = Date.now() - userData.joinTime;
            userData.totalTime += sessionTime;
            userData.joinTime = null;
            console.log(`${newState.member.displayName} の計測を停止。セッション時間: ${Math.floor(sessionTime / 1000)}秒`);
            
            // ★ 変更点: 計測が完了した瞬間にデータを保存する
            saveData();
            console.log(`データが即時保存されました。`);
        }
    } else if (!wasCountable && isCountable) {
        userData.joinTime = Date.now();
        console.log(`${newState.member.displayName} の計測を開始。`);
    }
});

// --- メッセージコマンドの処理 ---
client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.content.startsWith('t!')) return;

    const args = message.content.slice('t!'.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'add') {
        // 管理者権限をチェック
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('このコマンドを使用するには管理者権限が必要です。');
        }

        const timeString = args.join('');
        if (!timeString) {
            return message.reply('時間を指定してください (例: t!add 1h30m)');
        }

        const millisecondsToAdd = parseTime(timeString);
        if (millisecondsToAdd === 0) {
            return message.reply('無効な時間形式です。h(時間)、m(分)、s(秒)を使用してください。');
        }

        const MANUAL_ADJUSTMENT_ID = 'manual_adjustment';
        if (!userTimes.has(MANUAL_ADJUSTMENT_ID)) {
            userTimes.set(MANUAL_ADJUSTMENT_ID, { totalTime: 0, joinTime: null });
        }
        const manualData = userTimes.get(MANUAL_ADJUSTMENT_ID);
        manualData.totalTime += millisecondsToAdd;

        saveData();
        updateStatus();

        message.reply('時間を追加しました。');
    }
});



// --- 補助関数 --- (変更なし)

function parseTime(timeString) {
    let totalMilliseconds = 0;
    const regex = /(\d+)([hms])/g;
    let match;

    if (!/^\d+[hms]/.test(timeString)) return 0;

    while ((match = regex.exec(timeString)) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2];

        switch (unit) {
            case 'h':
                totalMilliseconds += value * 60 * 60 * 1000;
                break;
            case 'm':
                totalMilliseconds += value * 60 * 1000;
                break;
            case 's':
                totalMilliseconds += value * 1000;
                break;
        }
    }

    return totalMilliseconds;
}

function updateStatus() {
    // ... (前回のコードと同じなので省略) ...
    let totalMilliseconds = 0;
    for (const data of userTimes.values()) {
        totalMilliseconds += data.totalTime;
        if (data.joinTime) {
            totalMilliseconds += Date.now() - data.joinTime;
        }
    }
    const hours = Math.floor(totalMilliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((totalMilliseconds % (1000 * 60 * 60)) / (1000 * 60));
    const statusText = `合計作業: ${hours}時間${minutes}分`;
    client.user.setActivity(statusText, { type: ActivityType.Watching });
}

function formatTime(ms) {
    // ... (前回のコードと同じなので省略) ...
    if (ms < 1000) return `1秒未満`;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}時間 ${minutes}分 ${seconds}秒`;
}

// Botが終了する直前にデータを保存する (変更なし)
process.on('SIGINT', () => {
    console.log('Botを終了します。データを保存中...');
    saveData();
    process.exit();
});

client.login(process.env.DISCORD_TOKEN);