"use strict";

var TelegramBot = require('node-telegram-bot-api');
var urlencode = require('urlencode');
var request = require('request');
var feed = require('feed-read');
var fs = require('fs');
var syno = require('syno');

var cmd_download = "보고 싶은 동영상이 있어";
var cmd_download_progress = "다운로드 진행 상황을 알려줘";
var cmd_weather = "오늘 날씨 어때?";

var menu_home = [[cmd_download],
    [cmd_download_progress],
    [cmd_weather]];

var mode_home = "홈으로";
var mode_search_keyword = "검색어를 입력하세요";
var mode_choose_result = "선택";
var mode = mode_home;

function onMessage(msg){
    var user_id = msg.chat.username;
    if (hasPermission(user_id) == false) {
        console.log("Permission denied:" + user_id);
        return;
    }
    var chat_id = msg.chat.id;
    var msg_id = msg.message_id;
    var text = msg.text;
    if (text == null) {
        console.log("Unknown command");
        return;
    }

    console.log('Got text: %s', text);

    if (text == "ㄱㄱ" || text == "홈으로") {
        sendMessage(chat_id, msg_id, "무엇을 도와 드릴까요?", menu_home);
        mode = mode_home;
        return;
    }

    if (mode == mode_home) {
        if (text == cmd_download) {
            sendMessage(chat_id, msg_id, mode_search_keyword);
            mode = mode_search_keyword;
            return;
        } else if (text == cmd_download_progress) {
            checkDownloadProgress(chat_id, msg_id);
        } else {
            console.log("Unknown command");
            return;
        }
    } else if (mode == mode_search_keyword) {
        searchTorrent(text, chat_id, msg_id);
        return;
    } else if (mode == mode_choose_result) {
        var index = parseIndex(text);
        if (index == '99') {
            sendMessage(chat_id, msg_id, mode_search_keyword);
            mode = mode_search_keyword;
            return;
        }
        downloadContents(search_result[index].link, "video/from_telegram", chat_id, msg_id);
        return;
    }
}

function hasPermission(id) {
    if (config['valid_user'].indexOf(id) > -1) {
        return true;
    } else {
        return false;
    }
}

function parseIndex(msg) {
    console.log("parseIndex");
    var pattern = /\d\d*/; 
    var matches = pattern.exec(msg);
    console.log(matches[0]);
    return Number(matches[0]);
}

function sendMessage(chat_id, msg_id, reply_message, menu_list) {
    var opts = {
        reply_to_message_id: msg_id
    };
    if (menu_list != null) {
        opts.reply_markup = JSON.stringify({keyboard: menu_list, one_time_keyboard: true});
    } 
    bot.sendMessage(chat_id, reply_message, opts);
}

function searchTorrent(keyword, chat_id, msg_id) {
    request(rss_url + urlencode(keyword), function(error, response, body) {
        console.log('onResponse');
        if (error != null) {
            console.log("Error: " + error);
            return;
        }

        try {
            feed.rss(body, function(error, articles) {
                console.log('on rss parsed:' + error);
                if (error != null) {
                    console.log("[Error] feed.rss: " + error);
                    return;
                }
                var titles = new Array();
                for (var index in articles) {
                    if (index >= 99) {
                        break;
                    }
                    var title = new Array(0);
                    title.push( (index) + '. ' + articles[index]['title']);
                    titles.push(title);
                }

                titles.push(["99. 재검색"]);

                if (titles.length > 0) {
                    // console.log(articles);
                    sendMessage(chat_id, msg_id, "검색을 완료 하였습니다.", titles);
                    search_result = articles;
                    mode = mode_choose_result;
                } else {
                    sendMessage(chat_id, msg_id, "검색 결과가 없습니다. 재입력 하세요.", null);
                }

            });
        } catch (err) {
            console.log("Error: Can't parse feed");
            sendMessage(chat_id, msg_id, "검색어를 알 수 없습니다. 재입력 하세요.", null);
        }
    });
    sendMessage(chat_id, msg_id, "검색중입니다...", null);
}

function downloadContents(magnet_link, folder_name, chat_id, msg_id) {
    console.log(magnet_link, folder_name);
    //synology.dl.createTask({'uri':magnet_link, 'destination':folder_name}, function(error, data) {
    synology.dl.createTask({'uri':magnet_link, 'destination':folder_name}, function(error, data) {
        if (error != null) {
            console.log("[Error] downloadContents: " + error);
            process.exit(1);
        }
        sendMessage(chat_id, msg_id, "다운로드 중입니다. 완료되면 알려 드리겠습니다.", null);
        mode = mode_home;
        download_tasks.push({'uri':magnet_link, 'chat_id':chat_id, 'msg_id':msg_id});
        if (download_tasks.length == 1) {
            setTimeout(onCheckDownloadStatus, 1000);
        }
    });
}

function onCheckDownloadStatus() {
    console.log("onCheckDownloadStatus(): " + download_tasks.length);
    // TODO: try catch
    synology.dl.listTasks({'additional': "detail, transfer, file"}, function(error, data) {
        var delay = 60000;
        if (error != null) {
            console.log("[Error] listTasks: " + error);
            return;
        }
        console.log(data);
        var finished_tasks = download_tasks.filter(function(item, index, array) {
            for (var index in data.tasks) {
                if (data.tasks[index].additional.detail.uri == item.uri) {
                    if (data.tasks[index].status == "finished") {
                        sendMessage(item.chat_id, item.msg_id, "다운로드가 완료되었습니다.", null);
                        return false;
                    }
                    return true;
                }
            }
            return false;
        });
        download_tasks = finished_tasks;
        if (download_tasks.length > 0) {
           setTimeout(onCheckDownloadStatus, delay);
        }
    });

}

function checkDownloadProgress(chat_id, msg_id) {
    console.log("checkDownloadProgress()");
    // TODO: try catch
    synology.dl.listTasks({'additional': "detail, transfer, file"}, function(error, data) {
        if (error != null) {
            console.log("[Error] listTasks: " + error);
            return;
        }
        var found = false;
        for (var index in data.tasks) {
            if (data.tasks[index].status == "downloading") {
                console.log(data.tasks[index]);
                var title = data.tasks[index].title;
                var size = data.tasks[index].size;
                var size_downloaded = data.tasks[index].additional.transfer.size_downloaded;
                var speed_download = data.tasks[index].additional.transfer.speed_download;
                var progress_percent = (size_downloaded/size) * 100;
                var estimate_complete_sec = (size - size_downloaded) / speed_download;
                if (speed_download != 0) {
                    sendMessage(chat_id, msg_id, title +  "는(은) " + 
                        Math.floor(progress_percent) + "% 다운로드 받았습니다. " +
                        "예상 종료 시간은 " + convertForHuman(estimate_complete_sec) + " 후 입니다."  , null);
                } else {
                    sendMessage(chat_id, msg_id, title +  "는(은) 다운로드 준비 중입니다.", null);

                }
                found = true;
            } else if (data.tasks[index].status == "waiting") {
                sendMessage(chat_id, msg_id, title +  "는(은) 다운로드 준비 중입니다.", null);
                found = true;
            }
        }
        if (found == false) {
            sendMessage(chat_id, msg_id, "진행 중인 다운로드 작업은 없습니다.");
        }
    });
}

function convertForHuman(sec) {
    var levels = [
        [Math.floor(sec /31536000), '년'],
        [Math.floor((sec % 31536000) / 86400), '일'],
        [Math.floor(((sec % 31536000) % 86400) / 3600), '시'],
        [Math.floor((((sec % 31536000) % 86400) % 3600) / 60), '분'],
        [Math.floor(((sec % 31536000) % 86400) % 3600) % 60, '초']
    ];

    var return_text = '';
    for (var i = 0, max = levels.length; i < max; i++) {
        if (levels[i][0] === 0 ) {
            continue;
        }
        return_text += ' ' + levels[i][0] + ' ' + 
            (levels[i][0] === 1 ? levels[i][1].substr(0, levels[i][1].length-1): levels[i][1]);
    };
    return return_text.trim();
}

function loadConfig(config_file) {
    var config = JSON.parse(fs.readFileSync(config_file, 'utf8'));
    return config
}

	
var config = loadConfig("config.json");
if (config == null) {
    console.log("Error: Can't find config.json");
    process.exit(1);
}

var rss_url = config.torrent_search[0];
var valid_user = config.valid_user;
var token = config.token;
var search_result;
var bot = new TelegramBot(token, {polling: true});
var download_tasks = new Array();
var synology = new syno({
    protocol: "http",
    host: "localhost",
    port: "5000",
    account: config.syno_id,
    passwd: config.syno_passwd
});
bot.on('message', onMessage);


