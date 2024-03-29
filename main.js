"use strict";
const puppeteer = require("puppeteer");
const puppeteer_jquery = require("puppeteer-jquery");
const fs = require("fs");
const { decrypt } = require("./crypt");

const configs = JSON.parse(fs.readFileSync("password.json").toString());
configs.forEach((config) => {
    if (config.passwd) return;
    if (config.passwd_encrypted) config.passwd = decrypt(config.passwd_encrypted);
    if (!config.passwd) throw new Error("password not found");
});

const daka_and_baobei = async ({ browser, config }) => {
    const page = await browser.newPage();

    page.on('dialog', async dialog => {
        console.log(dialog.message());
        await dialog.dismiss();
        if (dialog.message().match(/登录密码错误/)) throw "登录密码错误";
        else if (dialog.message().match(/验证码错误/)) throw "验证码错误";
        else console.log("unhandledDialog");
    });

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const type = req.resourceType();
        if (type === "stylesheet") req.abort();
        else if (type === "image" && req.url().slice(-5) !== "login") req.abort();
        else req.continue();
    })

    //一定要等到验证码加载完 否则validatecode写不进去
    await page.goto("https://passport.ustc.edu.cn/login?service=https%3A%2F%2Fweixine.ustc.edu.cn%2F2020%2Fcaslogin", { waitUntil: "networkidle0" });
    const pageEx = puppeteer_jquery.pageExtend(page);

    console.log("正在进行:", config.id);
    await Promise.all([
        pageEx.jQuery('#username').val(config.id),
        pageEx.jQuery('#password').val(config.passwd),
        pageEx.evaluate(validatecode)
    ]);

    const login_state = await Promise.all([
        pageEx.waitForNavigation({ waitUntil: 'networkidle0' }),
        pageEx.evaluate(() => {
            $('#login').click();
        })
    ]).catch(async (e) => {
        console.log("错误：统一身份认证登录失败。", e);
        await pageEx.screenshot({ path: "login_error.png" });
        console.log("寄")
        return "error";
    });
    if (login_state === "error") {
        return 0;
    }
    console.log("统一身份认证已登录");

    await pageEx.evaluate(() => {
        $('input[name="juzhudi"][value="中校区"]').click();//中区

        $('input[name="has_fever"][value="0"]').click();//无症状
        $('input[name="last_touch_sars"][value="0"]').click();//无接触
        $('input[name="is_danger"][value="0"]').click();//无风险
        $('input[name="is_goto_danger"][value="0"]').click();//无旅居
    });

    if (await pageEx.jQuery('#report-submit-btn-a24').attr("disabled")) {
        await pageEx.evaluate(() => {
            $("#confirm-report-hook").click();
        })
        console.log("本人承诺以上填写内容均为最新信息，且真实可靠");
    }

    await Promise.all([
        pageEx.jQuery('[name="jinji_lxr"]').val(config.jinji[0]),
        pageEx.jQuery('[name="jinji_guanxi"]').val(config.jinji[1]),
        pageEx.jQuery('[name="jiji_mobile"]').val(config.jinji[2]),
        pageEx.jQuery('[name="other_detail"]').val(config.teshu)
    ]);
    pageEx.setViewport({
        width: 600, height: 1800,
    })

    const daka_state = await Promise.all([
        pageEx.waitForNavigation({ waitUntil: 'networkidle0' }),
        pageEx.evaluate(() => { $('#report-submit-btn-a24').click(); })
    ]).catch(async (e) => {
        console.log("错误：打卡失败。", e);
        await pageEx.screenshot({ path: "daka_error.png" });
        return "error";
    })
    if (daka_state === "error") {
        return 1;
    }
    console.log("打卡已完成");
    await pageEx.screenshot({ path: "daka_success.png" });

    await pageEx.goto("https://weixine.ustc.edu.cn/2020/apply/daliy");
    await pageEx.evaluate(() => {
        $('[name="lived"][value="2"]').click(); //合肥其他校区
        $('[name="reason"][value="3"]').click(); //跨校区上课、实验等

        $('.form-group.clearfix > label').click();
    });
    console.log("我已知悉以上规定并保证按要求执行，做好个人防护，少出行不聚集。");

    const baobei_state = await Promise.all([
        pageEx.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        pageEx.evaluate(() => { $('#report-submit-btn').click(); })
    ]).catch(async (e) => {
        console.log("错误：无法完成出校报备。", e);
        await pageEx.screenshot({ path: "baobei_error.png" });
        return "error";
    });

    await pageEx.evaluate(() => {
        $('input[name="return_college[]"][value="西校区"]').click();
        $('input[name="return_college[]"][value="东校区"]').click();
        $('input[name="return_college[]"][value="南校区"]').click();
        $('input[name="return_college[]"][value="北校区"]').click();
        $('input[name="return_college[]"][value="中校区"]').click();
        $('input[name="reason"]').val("自习");
    });
    await Promise.all([
        pageEx.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        pageEx.evaluate(() => { $('#report-submit-btn').click(); })
    ])
    if (baobei_state === "error") {
        return 2;
    }
    console.log("出校报备已完成");
    await pageEx.screenshot({ path: "baobei_success.png" });

    return 3;
};

const main = async () => {
    for (const config of configs) {
        let state = -1;
        let retry_sec = 10;
        const browser = await puppeteer.launch({ args: [], headless: false, });
        const page = await browser.newPage();
        while (true) {
            state = await daka_and_baobei({ browser, config }).catch((e) => {
                console.log("network error, try again later:\n", e);
                return -1;
            });
            if (state !== -1) break;
            await new Promise((res) => {
                console.log(`in ${retry_sec} seconds`);
                setTimeout(() => { res() }, retry_sec * 1000);
                retry_sec = retry_sec < 3000 ? retry_sec * 2 : retry_sec + 300;
            })
        }
        browser.close();
    }
    console.log("OK");
}

main();

const validatecode = () => {
    const compare_numbers = [
        '00000001111110000000000001111111111000001000111111111111000000011111111111111000001111110000111111000011111000000111110000111110000001111100011111000000001111100111110000000011111001111100000000111110011111000000001111100111110000000011111001111100000000111110011111000000001111100111110000000011111000111110100001111100001111100000011111000011111100001111110000011111111111111000000011111111111100000000011111111110000000000011111110000000',
        '00000011111111000000000011111111110000000000111111111100000100001111111111000000000011100111110000001010000001111100000001000000011111000000000000000111110000000000000001111100000100000000011111000000000000000111110000000000000001111100000000000000011111000000000000000111110001000000000001111100000000000000011111000000000000000111110000000000000001111100000000001111111111111110000011111111111111100000111111111111111000001111111111111110',
        '00001111111110000000001111111111111000000011111111111111100000111111111111111000001111000001111111010010000000001111110000000000000001111100000000000000011111000000000000000111110000000000001011111100000000000001111110000000000000111111100000000000011111110000000000001111111000000000001111111100000000000111111110000000000011111111000000000001111111100000000000111111111111111100001111111111111111000011111111111111110000111111111111111100',
        '00000111111110000000010111111111111010000001111111111111000000011111111111111000000110000001111110000000000000001111100000000000000011111000000000000000111110000000000001011111000000000011111111110000000000111111110000000000001111111111000000000011111111111000000000000001111111000000000000000111110000000000000001111100001000000000011111000011100000011111110000111111111111111000001111111111111110000001111111111110000000000111111110000000',
        '00000000011111110000000000000111111100000000000011111111001000000001111111110000000000011101111100000000001111011111000000000111100111110000000001110001111100000000111101011111010000011110000111110100000111000001111100000011110000011111000001111000000111110000011100000001111100000111111111111111111001111111111111111110011111111111111111100111111111111111111000000000000111110000000000000001111100000000000000011111000000000000000111110000',
        '01011111111111110000000111111111111100000001111111111111000000011111111111110000000111110000000000000001111100000000000000011111000000000000000111111111110000000001111111111110000000011111111111110001000111111111111110000001110000011111110000010000000011111100000000000000011111000000000000010111110000000000000001111100001000000000111111000011100000011111100000111111111111111000001111111111111100000001111111111110000000000011111110000000',
        '00000001011111100000000000011111111110000000011111111111110000001111111111111100000011111100000111000001111100000000010000011111000000000000001111100111111000000011111111111111000000111111111111111000001111111111111111000011111100000111111000111110000000111110001111100000001111100011111000000011111000111110000000111110000111100000001111100001111100000111110000001111111111111110000001111111111110000000001111111111000000000000111111000000',
        '00111111111111111100001111111111111111000011111111111111110000111111111111111100000000001000111110000000000000001111100000000000000111111000000000000001111100000000000000111111000000000000001111100000000000000111111000000000000001111100000000000000111111000000000000001111100000000100000011111000000000000001111110000000000000011111000000000000001111110000000000000011111000000000000001111110000000000000011111000000000000001111110000000000',
        '00000001111111000001000001111111111100000000111111111111100000011111111111111100000111111000111111000001111100000111110000011111000001111100000111111000111111000000111111111111100000000111111111110000000001111111111100000101111111111111110000011111100001111100001111100000001111100011111000000011111000111110000000111110001111100000001111100011111100000111111000011111111111111100000111111111111111000000111111111111100000000001111111000000',
        '00000001111110000000000001111111111000000000111111111111000000011111111111111000000111110000011111000011111000000011110000111110000000111100001111100000001111100011111000000011111000111110000000111110001111110000011111100001111111111111111000001111111111111110000001111111111111100000001111110011111000000000000001111100000101000000011111000001110000011111100000011111111111111000000111111111111100000000111111111100000000000011111100000000'
    ];
    var img_LT = new Image(128, 32);
    img_LT.src = 'https://passport.ustc.edu.cn/validatecode.jsp?type=login';
    var canvas = document.createElement("canvas");
    canvas.style.backgroundColor = "white";
    var ctx = canvas.getContext("2d");
    img_LT.onload = () => {
        ctx.drawImage(img_LT, 0, 0);
        var imgdata = ctx.getImageData(0, 0, 128, 32).data;
        var green_average = 0;
        for (var j = 0; j < 128 * 32; j++) {
            green_average += imgdata[4 * j + 1];
        }
        green_average /= (128 * 32);
        var numbers = ["", "", "", ""];
        for (var i = 4; i < 26; i++) {
            for (var j = 26; j < 46; j++) {
                var pixel = imgdata[4 * (128 * i + j) + 1] > green_average ? '0' : '1';
                numbers[0] += pixel;
            }
            for (var j = 47; j < 67; j++) {
                var pixel = imgdata[4 * (128 * i + j) + 1] > green_average ? '0' : '1';
                numbers[1] += pixel;
            }
            for (var j = 68; j < 88; j++) {
                var pixel = imgdata[4 * (128 * i + j) + 1] > green_average ? '0' : '1';
                numbers[2] += pixel;
            }
            for (var j = 89; j < 109; j++) {
                var pixel = imgdata[4 * (128 * i + j) + 1] > green_average ? '0' : '1';
                numbers[3] += pixel;
            }
        }
        var LT = "";
        for (var i = 0; i < 4; i++) {
            var index = '0';
            var min_different = 440;
            for (var j = 0; j < 10; j++) {
                var different = 0;
                for (var k = 0; k < 440; k++) {
                    if (numbers[i].charAt(k) != compare_numbers[j].charAt(k)) {
                        different += 1;
                    }
                }
                if (different < min_different) {
                    min_different = different;
                    index = j + '';
                }
            }
            LT += index;
        }
        $('.group #validate').val(LT);
    }
}
