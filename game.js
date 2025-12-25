// --- 定数定義 ---
const CHIP_TYPES = {
    GOLD: { name: '金', value: 3, css: 'gold' },
    SILVER: { name: '銀', value: 2, css: 'silver' },
    BRONZE: { name: '銅', value: 1, css: 'bronze' }
};

const CARD_TYPES = {
    RED: 'red',
    BLUE: 'blue'
};

const PLAYER_IDS = {
    YOU: 'you',
    CPU_A: 'cpuA',
    CPU_B: 'cpuB'
};

// ゲームの状態
const GAME_STATE = {
    SETUP: 'SETUP', // 初期設定中
    WAITING_FOR_CHIP: 'WAITING_FOR_CHIP', // プレイヤーのチップ選択待ち
    WAITING_FOR_CARD: 'WAITING_FOR_CARD', // プレイヤーのカード選択待ち
    PROCESSING: 'PROCESSING', // CPU思考中・処理中
    SUDDEN_DEATH: 'SUDDEN_DEATH', // サドンデス
    ROUND_END: 'ROUND_END', // ラウンド終了
    GAME_END: 'GAME_END' // ゲーム終了
};

// --- 4. サドンデス管理 クラス (修正版) ---
class SuddenDeath {
    constructor(game, finalistA_ID, finalistB_ID, arbiter_ID) {
        this.game = game; // メインのゲームクラスインスタンス
        this.modal = document.getElementById('sudden-death-modal');
        this.setupPhaseEl = document.getElementById('sd-setup-phase');
        this.matchPhaseEl = document.getElementById('sd-match-phase');
        this.nextButton = document.getElementById('sd-next-button');
        
        // ログの代わりに使うステータス表示エリア
        this.statusEl = document.getElementById('sd-setup-info');
        this.matchResultEl = document.getElementById('sd-match-result');

        // (改修) 対戦ボードUI
        this.ui = {
            opponentName: document.getElementById('sd-opponent-name'),
            opponentRole: document.getElementById('sd-opponent-role'),
            opponentScore: document.getElementById('sd-opponent-score'),
            opponentInitial: document.getElementById('sd-opponent-initial'), // (追加)
            opponentRed: document.getElementById('sd-opponent-red'),
            opponentBlue: document.getElementById('sd-opponent-blue'),
            opponentPlayed: document.getElementById('sd-opponent-played'),
            youName: document.getElementById('sd-you-name'),
            youRole: document.getElementById('sd-you-role'),
            youScore: document.getElementById('sd-you-score'),
            youInitial: document.getElementById('sd-you-initial'), // (追加)
            youRed: document.getElementById('sd-you-red'), // (追加)
            youBlue: document.getElementById('sd-you-blue'), // (追加)
            youPlayed: document.getElementById('sd-you-played')
        };

        // 参加者
        this.finalists = [this.game.players[finalistA_ID], this.game.players[finalistB_ID]];
        this.arbiter = this.game.players[arbiter_ID]; // 裁定者 (CPU or YOU)

        // UI要素
        document.getElementById('sd-finalist-a').textContent = finalistA_ID;
        document.getElementById('sd-finalist-b').textContent = finalistB_ID;
        document.getElementById('sd-arbiter').textContent = arbiter_ID;
        
        // モーダル内のUIリセット
        this.statusEl.innerHTML = '<p>サドンデス「カラー・マッチ」が発生します。</p>';
    }

    // サドンデス開始
    async run() {
        this.game.log('<b>サドンデス「カラー・マッチ」発生！</b>');
        this.modal.style.display = 'flex';
        this.game.gameState = GAME_STATE.SUDDEN_DEATH;
        this.setupPhaseEl.style.display = 'block';
        this.matchPhaseEl.style.display = 'none';
        document.getElementById('sd-hand-selection').innerHTML = ''; // UIリセット
        document.getElementById('sd-role-selection').innerHTML = ''; // UIリセット
        this.matchResultEl.innerHTML = ''; // UIリセット

        // --- ステップ1: 手札の準備と調整 ---
        // 各プレイヤーの本戦カード（赤・青の枚数）で手札を作成
        this.finalists.forEach(p => {
            p.sd_hand = [];
            for (let i = 0; i < p.cards.red; i++) p.sd_hand.push(CARD_TYPES.RED);
            for (let i = 0; i < p.cards.blue; i++) p.sd_hand.push(CARD_TYPES.BLUE);
            p.sd_totalCards = p.sd_hand.length;
        });

        // 総カード枚数が少ない方を基準に「ラウンド数」を決定
        const p0_count = this.finalists[0].sd_totalCards;
        const p1_count = this.finalists[1].sd_totalCards;
        this.matchRounds = Math.min(p0_count, p1_count);

        let setupMsg = `手札調整。総枚数: ${this.finalists[0].id}(${p0_count}枚) vs ${this.finalists[1].id}(${p1_count}枚).<br>`;
        
        if (this.matchRounds === 0) {
             setupMsg += "<b>対戦枚数が0枚のため、引き分け（ランダム）扱いです。</b>";
        } else {
            setupMsg += `<b>サドンデスは ${this.matchRounds} ラウンド行われます。</b>`;
        }
        this.statusEl.innerHTML = setupMsg;
        
        // 手札調整の実行（多い方が選ぶ）
        for (const player of this.finalists) {
            if (player.sd_totalCards > this.matchRounds) {
                await this.adjustHand(player); // 手札を選んでもらう
            }
        }

        // --- ステップ2: 役割の決定 ---
        let roleSelector = null; // 役割を選ぶ権利を持つプレイヤー
        // ケースA：総カード枚数が異なる
        if (p0_count !== p1_count) {
            roleSelector = (p0_count < p1_count) ? this.finalists[0] : this.finalists[1];
            this.statusEl.innerHTML = `ケースA: 総カード枚数が少なかった <b>${roleSelector.id}</b> が役割を選択します。`;
        } else {
        // ケースB：総カード枚数が同数
            this.statusEl.innerHTML = `ケースB: 総カード枚数が同数。裁定者 <b>${this.arbiter.id}</b> が選択権を指名します。`;
            roleSelector = await this.getArbiterDecision();
        }

        // 役割（マッチャー/ミスマッチャー）の決定
        await this.assignRoles(roleSelector);
        
        // (this.you と this.opponent は assignRoles で設定済み)

        // --- ステップ3: ゲームの進行 ---
        this.setupPhaseEl.style.display = 'none';
        this.matchPhaseEl.style.display = 'block';
        document.getElementById('sd-match-total').textContent = this.matchRounds;
        
        // 対戦ボードのスコアをリセット
        this.ui.youScore.textContent = 0;
        this.ui.opponentScore.textContent = 0;

        let matcherPoints = 0;
        let mismatcherPoints = 0;

        for (let i = 0; i < this.matchRounds; i++) {
            document.getElementById('sd-match-round').textContent = i + 1;
            
            // プレイする前にカード表示をリセット
            this.ui.youPlayed.textContent = '?';
            this.ui.youPlayed.className = 'sd-played-card';
            this.ui.opponentPlayed.textContent = '?';
            this.ui.opponentPlayed.className = 'sd-played-card';
            
            // 各プレイヤーのカード選択
            const matcherCard = await this.getMatchCard(this.matcher);
            const mismatcherCard = await this.getMatchCard(this.mismatcher);
            
            // (改修) 手札が減ったことをUIに反映
            this.updateAllHandUIs();

            // 出したカードをUIに表示
            const matcherPlayerUI = (this.matcher === this.you) ? this.ui.youPlayed : this.ui.opponentPlayed;
            const mismatcherPlayerUI = (this.mismatcher === this.you) ? this.ui.youPlayed : this.ui.opponentPlayed;
            
            matcherPlayerUI.textContent = matcherCard === 'red' ? 'R' : 'B';
            matcherPlayerUI.classList.add(matcherCard);
            
            mismatcherPlayerUI.textContent = mismatcherCard === 'red' ? 'R' : 'B';
            mismatcherPlayerUI.classList.add(mismatcherCard);
            
            // 結果表示
            this.matchResultEl.innerHTML = `${this.matcher.id} (マッチャー) は <b>${matcherCard}</b> を出しました。<br>`;
            this.matchResultEl.innerHTML += `${this.mismatcher.id} (ミスマッチャー) は <b>${mismatcherCard}</b> を出しました。`;

            // ポイント計算
            if (matcherCard === mismatcherCard) {
                matcherPoints++;
                this.matchResultEl.innerHTML += "<br><b>→ 一致！ マッチャー +1</b>";
            } else {
                mismatcherPoints++;
                this.matchResultEl.innerHTML += "<br><b>→ 不一致！ ミスマッチャー +1</b>";
            }
            
            // スコアボードUIを更新
            if (this.you) {
                this.ui.youScore.textContent = (this.you === this.matcher) ? matcherPoints : mismatcherPoints;
            }
            if (this.opponent) {
                 this.ui.opponentScore.textContent = (this.opponent === this.matcher) ? matcherPoints : mismatcherPoints;
            }
            
            await this.game.sleep(2000); // 結果表示
        }

        // --- ステップ4: 勝者の決定 ---
        let winner, loser, winnerPoints;
        if (matcherPoints > mismatcherPoints) {
            winner = this.matcher;
            loser = this.mismatcher;
            winnerPoints = matcherPoints;
        } else if (mismatcherPoints > matcherPoints) {
            winner = this.mismatcher;
            loser = this.matcher;
            winnerPoints = mismatcherPoints;
        } else {
            // 同点 (ルール上はじゃんけん)
            this.matchResultEl.innerHTML += "<br>サドンデス同点。ランダムで勝者を決定します。";
            if (Math.random() > 0.5) {
                winner = this.matcher; loser = this.mismatcher;
            } else {
                winner = this.mismatcher; loser = this.matcher;
            }
            winnerPoints = matcherPoints; // ポイントはそのまま
        }

        this.matchResultEl.innerHTML += `<br><b>${winner.id}</b> がサドンデスに勝利！`;
        await this.game.sleep(2000);
        this.modal.style.display = 'none';

        // メインゲームに結果を返す
        return {
            winner: winner.id,
            loser: loser.id,
            winnerSDPoints: winnerPoints // サドンデスポイント
        };
    }

    // (SD) 手札調整
    async adjustHand(player) {
        // CPUは自動選択
        if (player.id !== PLAYER_IDS.YOU) {
            this.statusEl.innerHTML = `<b>${player.id}</b> (CPU) が手札を ${this.matchRounds} 枚に調整しています...`;
            // thinkSDHand は適切なロジック (thinkSDHand_MediumHard) を参照
            player.sd_hand = player.thinkSDHand([...player.sd_hand], this.matchRounds);
            await this.game.sleep(1000);
            return;
        }

        // プレイヤー（あなた）の手札選択
        this.statusEl.innerHTML = `<b>あなた</b>は手札 (${player.sd_totalCards}枚) から ${this.matchRounds} 枚を選んでください。`;
        const handSelectorEl = document.getElementById('sd-hand-selection');
        handSelectorEl.innerHTML = 'あなたの手札: ';
        
        let redCount = player.cards.red; // (注) これは初期在庫
        let blueCount = player.cards.blue; // (注) これは初期在庫
        let selectedCards = [];

        // UI作成
        const redBtn = document.createElement('button');
        redBtn.className = 'sd-card-button red';
        redBtn.textContent = `R (${redCount})`;
        
        const blueBtn = document.createElement('button');
        blueBtn.className = 'sd-card-button blue';
        blueBtn.textContent = `B (${blueCount})`;
        
        handSelectorEl.appendChild(redBtn);
        handSelectorEl.appendChild(blueBtn);

        return new Promise(resolve => {
            // (★) --- バグ修正 (v2) ---
            const updateButtons = () => {
                const remaining = this.matchRounds - selectedCards.length;
                this.statusEl.innerHTML = `<b>あなた</b>は手札から残り <b>${remaining}</b> 枚を選んでください。`;
                
                // (注) redCount / blueCount は「ボタンを押せる残り回数（＝在庫）」
                redBtn.textContent = `R (${redCount})`;
                blueBtn.textContent = `B (${blueCount})`;

                // (注) player.cards.red / blue は「初期在庫の最大値」
                const initialRed = player.cards.red;
                const initialBlue = player.cards.blue;

                // (例: 5枠, R4, B5 -> 青は最低1枚 (5-4) 必要)
                const minBlueRequired = Math.max(0, this.matchRounds - initialRed);
                const minRedRequired = Math.max(0, this.matchRounds - initialBlue);
                
                const selectedRed = selectedCards.filter(c => c === CARD_TYPES.RED).length;
                const selectedBlue = selectedCards.filter(c => c === CARD_TYPES.BLUE).length;


                // 赤ボタンを無効にする条件
                // 1. 赤の在庫が0
                redBtn.disabled = (redCount === 0);
                // 2. または、これ以上赤を取ると、青の最低必要枚数を満たせなくなる
                if (!redBtn.disabled && (remaining > 0)) { // 在庫があり、まだ枠がある
                    // (残り枠 - 1) < (青の最低必要枚数 - 既に選んだ青)
                    // 例: 5枠, R4, B5 (青最低1)。Rを0枚, Bを0枚選んだ (残り5)。
                    // 赤を押す (残り4)。 4 < (1 - 0) ? No.
                    // 例: 5枠, R4, B5 (青最低1)。Rを4枚選んだ (残り1)。
                    // 赤を押したい (在庫0) -> disabled
                    // 例: 5枠, R4, B5 (青最低1)。Rを3枚選んだ (残り2)。
                    // 赤を押す (残り1)。 1 < (1 - 0) ? No.
                    // (バグ修正) (remaining - 1) ではなく、 (現在の青在庫 blueCount) が (最低必要青枚数 - 選択済み青) を下回るか
                    // (remaining - 1) < (minBlueRequired - selectedBlue)
                    // ↓
                    // (blueCount) < (minBlueRequired - selectedBlue)
                    
                    // 「赤ボタンを押せなくする」＝「赤を選んだら詰む」
                    // ＝「(残り枠 - 1) が、(残りの青在庫) よりも大きい」
                    // ＝「(remaining - 1) > blueCount」
                    if ((remaining - 1) > blueCount) {
                         redBtn.disabled = true;
                    }
                }
                
                // 青ボタンを無効にする条件
                // 1. 青の在庫が0
                blueBtn.disabled = (blueCount === 0);
                if (!blueBtn.disabled && (remaining > 0)) { // 在庫があり、まだ枠がある
                    // 「(remaining - 1) > redCount」
                    if ((remaining - 1) > redCount) {
                        blueBtn.disabled = true;
                    }
                }
                // (★) --- バグ修正 (v2) ここまで ---

                if (remaining === 0) {
                    player.sd_hand = selectedCards;
                    handSelectorEl.innerHTML = `手札決定: ${selectedCards.filter(c=>c==='red').length}R, ${selectedCards.filter(c=>c==='blue').length}B`;
                    resolve();
                }
            }; // updateButtons 定義終わり

            redBtn.onclick = () => {
                // (disabledでなければ)
                selectedCards.push(CARD_TYPES.RED);
                redCount--; // 在庫を減らす
                updateButtons();
            };
            blueBtn.onclick = () => {
                // (disabledでなければ)
                selectedCards.push(CARD_TYPES.BLUE);
                blueCount--; // 在庫を減らす
                updateButtons();
            };
            
            updateButtons(); // 初期呼び出し
        });
    }

    // (SD) 裁定者の指名
    async getArbiterDecision() {
        if (this.arbiter.id !== PLAYER_IDS.YOU) {
            // 裁定者がCPUの場合、ランダムで指名
            const choice = (Math.random() > 0.5) ? this.finalists[0] : this.finalists[1];
            this.statusEl.innerHTML = `裁定者 (CPU) は <b>${choice.id}</b> に選択権を与えました。`;
            await this.game.sleep(1000);
            return choice;
        }

        // 裁定者があなた
        this.statusEl.innerHTML = "<b>あなた</b> (裁定者) が、役割の選択権をどちらに与えるか指名してください。";
        const roleSelectorEl = document.getElementById('sd-role-selection');
        
        return new Promise(resolve => {
            this.finalists.forEach(p => {
                const btn = document.createElement('button');
                btn.textContent = `-> ${p.id} に選択権`;
                btn.onclick = () => {
                    this.statusEl.innerHTML = `あなたは <b>${p.id}</b> を指名しました。`;
                    roleSelectorEl.innerHTML = '';
                    resolve(p);
                };
                roleSelectorEl.appendChild(btn);
            });
        });
    }

    // (SD) 役割の決定
    async assignRoles(selector) {
        let matcher, mismatcher;
        // 役割を選択するのがCPU
        if (selector.id !== PLAYER_IDS.YOU) {
            const choice = selector.thinkSDRole(); // "matcher" or "mismatcher"
            this.statusEl.innerHTML = `<b>${selector.id}</b> (CPU) が役割を選択...`;
            await this.game.sleep(1000);
            
            if (choice === 'matcher') {
                matcher = selector;
                mismatcher = this.finalists.find(p => p.id !== selector.id);
            } else {
                mismatcher = selector;
                matcher = this.finalists.find(p => p.id !== selector.id);
            }
            this.statusEl.innerHTML = `<b>${selector.id}</b> は ${choice} を選びました。`;
            
        } else {
        // 役割を選択するのがあなた
            this.statusEl.innerHTML = "<b>あなた</b>が役割を選んでください。";
            const roleSelectorEl = document.getElementById('sd-role-selection');
            
            matcher = await new Promise(resolve => {
                const btnMatch = document.createElement('button');
                btnMatch.textContent = 'マッチャー (一致で勝利)';
                btnMatch.onclick = () => {
                    roleSelectorEl.innerHTML = '';
                    resolve(selector); // あなたがマッチャー
                };
                
                const btnMismatch = document.createElement('button');
                btnMismatch.textContent = 'ミスマッチャー (不一致で勝利)';
                btnMismatch.onclick = () => {
                    roleSelectorEl.innerHTML = '';
                    resolve(this.finalists.find(p => p.id !== selector.id)); // 相手がマッチャー
                };
                roleSelectorEl.appendChild(btnMatch);
                roleSelectorEl.appendChild(btnMismatch);
            });
            mismatcher = this.finalists.find(p => p.id !== matcher.id);
        }

        this.matcher = matcher;
        this.mismatcher = mismatcher;
        
        // プレイヤー(You)と相手(Opponent)を特定
        this.you = this.finalists.find(p => p.id === PLAYER_IDS.YOU);
        this.opponent = this.finalists.find(p => p.id !== PLAYER_IDS.YOU);

        // UIに役割を即時反映
        if (this.you) {
            this.ui.youName.textContent = this.you.id;
            this.ui.youRole.textContent = (this.you === this.matcher) ? 'マッチャー' : 'ミスマッチャー';
        }
        if (this.opponent) {
            this.ui.opponentName.textContent = this.opponent.id;
            this.ui.opponentRole.textContent = (this.opponent === this.matcher) ? 'マッチャー' : 'ミスマッチャー';
        }
        
        // (改修) UIに「本戦手札」をセット (依頼2)
        if (this.you) {
            // (注) player.cards は本戦終了時の枚数
            this.ui.youInitial.textContent = `R(${this.you.cards.red}), B(${this.you.cards.blue})`;
        }
        if (this.opponent) {
            this.ui.opponentInitial.textContent = `R(${this.opponent.cards.red}), B(${this.opponent.cards.blue})`;
        }
        // (改修) UIに「現在の手札」をセット (依頼1)
        this.updateAllHandUIs();

        this.statusEl.innerHTML = `役割決定: マッチャー=<b>${matcher.id}</b>, ミスマッチャー=<b>${mismatcher.id}</b>`;
        await this.game.sleep(1500);
    }

    // (SD) 両方の手札枚数をUIに表示 (依頼1, 依頼2(Current))
    updateAllHandUIs() {
        if (this.you) {
            const redCount = this.you.sd_hand.filter(c => c === CARD_TYPES.RED).length;
            const blueCount = this.you.sd_hand.filter(c => c === CARD_TYPES.BLUE).length;
            this.ui.youRed.textContent = `R (${redCount})`;
            this.ui.youBlue.textContent = `B (${blueCount})`;
        }
        if (this.opponent) {
            const redCount = this.opponent.sd_hand.filter(c => c === CARD_TYPES.RED).length;
            const blueCount = this.opponent.sd_hand.filter(c => c === CARD_TYPES.BLUE).length;
            this.ui.opponentRed.textContent = `R (${redCount})`;
            this.ui.opponentBlue.textContent = `B (${blueCount})`;
        }
    }

    // (SD) カラー・マッチ対戦のカード選択
    async getMatchCard(player) {
        let card;
        // CPUの選択
        if (player.id !== PLAYER_IDS.YOU) {
            // CPUはランダムで手札から1枚選ぶ (sd_handから削除)
            const index = Math.floor(Math.random() * player.sd_hand.length);
            card = player.sd_hand.splice(index, 1)[0];

        } else {
        // あなたの選択
            this.matchResultEl.innerHTML = "<b>あなた</b>のカードを選んでください。";
            this.updateAllHandUIs(); // (修正)
            
            const handEl = document.getElementById('sd-player-hand');
            handEl.innerHTML = 'Your Hand (Select 1): ';
            
            const redCount = player.sd_hand.filter(c => c === CARD_TYPES.RED).length;
            const blueCount = player.sd_hand.filter(c => c === CARD_TYPES.BLUE).length;
            
            card = await new Promise(resolve => {
                const redBtn = document.createElement('button');
                redBtn.className = 'sd-card-button red';
                redBtn.textContent = `R (${redCount})`;
                redBtn.disabled = (redCount === 0);
                redBtn.onclick = () => {
                    const index = player.sd_hand.findIndex(c => c === CARD_TYPES.RED);
                    player.sd_hand.splice(index, 1); // 手札から削除
                    handEl.innerHTML = 'Your Hand (Select 1): '; // 元に戻す
                    resolve(CARD_TYPES.RED);
                };
                
                const blueBtn = document.createElement('button');
                blueBtn.className = 'sd-card-button blue';
                blueBtn.textContent = `B (${blueCount})`;
                blueBtn.disabled = (blueCount === 0);
                blueBtn.onclick = () => {
                    const index = player.sd_hand.findIndex(c => c === CARD_TYPES.BLUE);
                    player.sd_hand.splice(index, 1); // 手札から削除
                    handEl.innerHTML = 'Your Hand (Select 1): '; // 元に戻す
                    resolve(CARD_TYPES.BLUE);
                };
                
                handEl.appendChild(redBtn);
                handEl.appendChild(blueBtn);
            });
        }
        return card;
    }
}


// --- 3. CPUプレイヤー クラス (AIロジックの核) ---
class CPUPlayer {
    constructor(id, level) {
        this.id = id;
        this.vp = 0;
        this.setLevel(level); // 難易度を設定
        this.resetRound(); // ラウンド毎のデータを初期化
    }

    // (★) (新設) サドンデス手札調整 (中級・上級)
    thinkSDHand_MediumHard(availableCards, numToTake) {
        // thinkCard_MediumHard とほぼ同じだが、desiredCard の決定ロジックが違う
        const chosenCards = [];
        let cards = [...availableCards];
        
        // desiredCard は「赤青のバランスをとる」＝ availableCards の中で少ない方
         const redCount = availableCards.filter(c=>c===CARD_TYPES.RED).length;
         const blueCount = availableCards.filter(c=>c===CARD_TYPES.BLUE).length;
         let desiredCard = (redCount < blueCount) ? CARD_TYPES.RED : CARD_TYPES.BLUE;

        const oppositeCard = (desiredCard === CARD_TYPES.RED) ? CARD_TYPES.BLUE : CARD_TYPES.RED;

        // 1. 欲しいカードを優先的に取る
        let takenCount = 0;
        while (takenCount < numToTake) {
            const index = cards.findIndex(c => c === desiredCard);
            if (index !== -1) {
                chosenCards.push(cards.splice(index, 1)[0]);
                takenCount++;
            } else {
                break; // 欲しいカードがもうない
            }
        }

        // 2. まだ枠が残っていれば、反対のカード
        while (takenCount < numToTake && cards.length > 0) {
            const index = cards.findIndex(c => c === oppositeCard);
            if (index !== -1) {
                chosenCards.push(cards.splice(index, 1)[0]);
            } else {
                 // 反対のカードもない場合（市場が赤だけ、など）
                chosenCards.push(cards.pop());
            }
            takenCount++;
        }
        return chosenCards;
    }


    // 難易度設定 (★ 修正)
    setLevel(level) {
        this.level = level; // 'easy', 'medium', 'hard'
        
        switch (level) {
            case 'easy':
                this.thinkChip = this.thinkChip_Easy;
                this.thinkCard = this.thinkCard_Easy;
                this.thinkSDHand = this.thinkCard_Easy; // サドンデス手札もランダム
                this.thinkSDRole = this.thinkSDRole_Easy;
                break;
            case 'hard':
                this.thinkChip = this.thinkChip_Hard;
                this.thinkCard = this.thinkCard_MediumHard;
                this.thinkSDHand = this.thinkSDHand_MediumHard; // (修正)
                this.thinkSDRole = this.thinkSDRole_Hard;
                break;
            case 'medium':
            default:
                this.thinkChip = this.thinkChip_Medium;
                this.thinkCard = this.thinkCard_MediumHard;
                this.thinkSDHand = this.thinkSDHand_MediumHard; // (修正)
                this.thinkSDRole = this.thinkSDRole_Easy; // 役割はランダム
                break;
        }
    }

    // ラウンド開始時にリセット
    resetRound() {
        this.chips = [CHIP_TYPES.GOLD, CHIP_TYPES.SILVER, CHIP_TYPES.SILVER, CHIP_TYPES.BRONZE, CHIP_TYPES.BRONZE];
        this.cards = { [CARD_TYPES.RED]: 0, [CARD_TYPES.BLUE]: 0 };
        this.playedChip = null; // このミニラウンドで出すチップ
    }

    getCardDifference() {
        return this.cards.red - this.cards.blue; // 正負の値（赤が多いと+)
    }
    
    getAbsoluteCardDifference() {
        return Math.abs(this.getCardDifference());
    }

    // --- AI思考ロジック：チップ選択 ---

    // [初級] ランダムにチップを選ぶ
    thinkChip_Easy(marketCards, gameState) {
        const randomIndex = Math.floor(Math.random() * this.chips.length);
        this.playedChip = this.chips.splice(randomIndex, 1)[0];
        return this.playedChip;
    }

    // [中級] 差額を埋めるカードがあれば銀か銅、なければ銅。金は温存。
    thinkChip_Medium(marketCards, gameState) {
        const desiredCard = this.getDesiredCardType();
        const hasDesiredCard = marketCards.includes(desiredCard);
        
        const hasGold = this.chips.includes(CHIP_TYPES.GOLD);
        const nonGoldChips = this.chips.filter(c => c !== CHIP_TYPES.GOLD);

        let chipToPlay;

        if (hasDesiredCard && nonGoldChips.length > 0) {
            // 欲しいカードがあり、金以外が残っている
            // 銀があれば銀、なければ銅
            if (nonGoldChips.includes(CHIP_TYPES.SILVER)) {
                chipToPlay = CHIP_TYPES.SILVER;
            } else {
                chipToPlay = CHIP_TYPES.BRONZE;
            }
        } else if (nonGoldChips.length > 0) {
            // 欲しいカードがない or 金以外が残っている
            // 銅を優先的に使う
            if (nonGoldChips.includes(CHIP_TYPES.BRONZE)) {
                chipToPlay = CHIP_TYPES.BRONZE;
            } else {
                chipToPlay = CHIP_TYPES.SILVER;
            }
        } else {
            // 金しか残っていない
            chipToPlay = CHIP_TYPES.GOLD;
        }

        // 実際にそのチップを持っているか確認し、配列から削除
        const chipIndex = this.chips.findIndex(c => c === chipToPlay);
        if (chipIndex === -1) {
            // 予期せぬエラー：持ってるはずのチップがない場合、残ってるチップからランダム
            return this.thinkChip_Easy(marketCards, gameState);
        }
        this.playedChip = this.chips.splice(chipIndex, 1)[0];
        return this.playedChip;
    }

    // [上級] 中級ロジックに加え、他プレイヤーのチップ使用状況を考慮
    thinkChip_Hard(marketCards, gameState) {
        // 他プレイヤー（あなた、もう一人のCPU）の残りチップ状況
        const otherPlayers = Object.values(gameState.players).filter(p => p.id !== this.id);
        const othersHaveGold = otherPlayers.some(p => p.chips.includes(CHIP_TYPES.GOLD));

        const desiredCard = this.getDesiredCardType();
        const hasDesiredCard = marketCards.includes(desiredCard);
        
        let chipToPlay = null;

        // 1. どうしても1位が取りたい状況か？ (欲しいカードが市場に2枚以上)
        const desiredCount = marketCards.filter(c => c === desiredCard).length;
        if (desiredCount >= 2 && this.chips.includes(CHIP_TYPES.GOLD)) {
            // 他のプレイヤーも金を残しているか？
            if (!othersHaveGold) {
                // 自分だけが金持ちなら、ここで使う価値がある
                chipToPlay = CHIP_TYPES.GOLD;
            } else {
                // 他人も金を持っているなら、カブる危険性。中級ロジックに落とす
                // (注) 中級ロジックは this.chips を変更するため、clone を渡す...必要はなく、
                // 中級ロジックを呼び出した後に、戻す操作を行う
                const mediumChip = this.thinkChip_Medium(marketCards, gameState);
                this.chips.push(mediumChip); // 使ったチップを一旦戻す
                chipToPlay = mediumChip; // 中級の選択を採用
            }
        }

        // 2. 上級ロジックで決まらなければ、中級ロジックを実行
        if (!chipToPlay) {
            return this.thinkChip_Medium(marketCards, gameState);
        }

        // 上級ロジックでチップが決定した場合
        const chipIndex = this.chips.findIndex(c => c === chipToPlay);
        if (chipIndex === -1) {
             return this.thinkChip_Easy(marketCards, gameState);
        }
        this.playedChip = this.chips.splice(chipIndex, 1)[0];
        return this.playedChip;
    }


    // --- AI思考ロジック：カード選択 ---

    // [初級] ランダムにカードを選ぶ (サドンデス手札調整にも使用)
    thinkCard_Easy(availableCards, numToTake) {
        const chosenCards = [];
        let cards = [...availableCards];
        for (let i = 0; i < numToTake && cards.length > 0; i++) {
            const randomIndex = Math.floor(Math.random() * cards.length);
            chosenCards.push(cards.splice(randomIndex, 1)[0]);
        }
        return chosenCards;
    }

    // [中級・上級] 差額を0に近づけるカードを最優先で選ぶ (★ 修正)
    thinkCard_MediumHard(availableCards, numToTake) {
        const chosenCards = [];
        let cards = [...availableCards];
        
        // (★ 修正: サドンデス手札調整用の分岐を削除。この関数は本戦専用)
        let desiredCard = this.getDesiredCardType(); 

        const oppositeCard = (desiredCard === CARD_TYPES.RED) ? CARD_TYPES.BLUE : CARD_TYPES.RED;

        // 1. 欲しいカードを優先的に取る
        let takenCount = 0;
        while (takenCount < numToTake) {
            const index = cards.findIndex(c => c === desiredCard);
            if (index !== -1) {
                chosenCards.push(cards.splice(index, 1)[0]);
                takenCount++;
            } else {
                break; // 欲しいカードがもうない
            }
        }

        // 2. まだ枠が残っていれば、反対のカード
        while (takenCount < numToTake && cards.length > 0) {
            const index = cards.findIndex(c => c === oppositeCard);
            if (index !== -1) {
                chosenCards.push(cards.splice(index, 1)[0]);
            } else {
                 // 反対のカードもない場合（市場が赤だけ、など）
                chosenCards.push(cards.pop());
            }
            takenCount++;
        }
        return chosenCards;
    }

    // 現在の差額から、欲しいカード（赤か青）を判断する
    getDesiredCardType() {
        const diff = this.getCardDifference(); // (赤 - 青)
        if (diff > 0) {
            return CARD_TYPES.BLUE; // 赤が多いので青が欲しい
        } else if (diff < 0) {
            return CARD_TYPES.RED; // 青が多いので赤が欲しい
        } else {
            // 差額0の理想状態。どちらでもよい
            return (Math.random() > 0.5) ? CARD_TYPES.RED : CARD_TYPES.BLUE;
        }
    }
    
    // --- AI思考ロジック：サドンデス ---
    
    // [初級・中級] 役割をランダムに選ぶ
    thinkSDRole_Easy() {
        return (Math.random() > 0.5) ? 'matcher' : 'mismatcher';
    }
    
    // [上級] 自分の手札の偏りに基づいて役割を選ぶ
    thinkSDRole_Hard() {
        if (!this.sd_hand || this.sd_hand.length === 0) return this.thinkSDRole_Easy();
        
        const redCount = this.sd_hand.filter(c => c === CARD_TYPES.RED).length;
        const blueCount = this.sd_hand.filter(c => c === CARD_TYPES.BLUE).length;
        // 手札が偏っている (6:4以上) なら、ミスマッチャーが有利
        if (Math.abs(redCount - blueCount) > this.sd_hand.length * 0.2) {
            return 'mismatcher';
        }
        // バランスが取れているなら、マッチャーが有利
        return 'matcher';
    }
}


// --- 2. プレイヤー（あなた） クラス ---
class Player {
    constructor(id) {
        this.id = id;
        this.vp = 0; // 勝利点
        this.resetRound();
    }

    resetRound() {
        this.chips = [CHIP_TYPES.GOLD, CHIP_TYPES.SILVER, CHIP_TYPES.SILVER, CHIP_TYPES.BRONZE, CHIP_TYPES.BRONZE];
        this.cards = { [CARD_TYPES.RED]: 0, [CARD_TYPES.BLUE]: 0 };
        this.playedChip = null;
    }

    getAbsoluteCardDifference() {
        return Math.abs(this.cards.red - this.cards.blue);
    }
}


// --- 1. ゲーム管理 クラス (メインロジック) ---
class EquilibriumMarketGame {
    constructor() {
        // DOM要素の取得
        this.modal = document.getElementById('setup-modal');
        this.startButton = document.getElementById('start-game-button');
        this.logEl = document.getElementById('game-log');
        this.marketContainer = document.getElementById('market-cards');
        
        this.ui = {
            round: document.getElementById('current-round'),
            miniRound: document.getElementById('mini-round'),
            playerVP: document.getElementById('player-vp'),
            cpuAVP: document.getElementById('cpu-a-vp'),
            cpuBVP: document.getElementById('cpu-b-vp'),
            playerChips: document.getElementById('player-chips'),
            cpuAChips: document.getElementById('cpu-a-chips'),
            cpuBChips: document.getElementById('cpu-b-chips'),
            playerRed: document.getElementById('player-red'),
            playerBlue: document.getElementById('player-blue'),
            playerDiff: document.getElementById('player-diff'),
            cpuARed: document.getElementById('cpu-a-red'),
            cpuABlue: document.getElementById('cpu-a-blue'),
            cpuADiff: document.getElementById('cpu-a-diff'),
            cpuBRed: document.getElementById('cpu-b-red'),
            cpuBBlue: document.getElementById('cpu-b-blue'),
            cpuBDiff: document.getElementById('cpu-b-diff'),
            cpuALevel: document.getElementById('cpu-a-level'),
            cpuBLevel: document.getElementById('cpu-b-level'),
        };

        this.gameState = GAME_STATE.SETUP;
        // イベントリスナーの設定
        this.startButton.addEventListener('click', () => this.startGame());
    }

    // ゲーム開始処理
    startGame() {
        const cpuALevel = document.getElementById('cpu-a-select').value;
        const cpuBLevel = document.getElementById('cpu-b-select').value;

        // プレイヤーとCPUのインスタンスを作成
        this.player = new Player(PLAYER_IDS.YOU);
        this.cpuA = new CPUPlayer(PLAYER_IDS.CPU_A, cpuALevel);
        this.cpuB = new CPUPlayer(PLAYER_IDS.CPU_B, cpuBLevel);

        this.players = {
            [PLAYER_IDS.YOU]: this.player,
            [PLAYER_IDS.CPU_A]: this.cpuA,
            [PLAYER_IDS.CPU_B]: this.cpuB
        };

        // UIにCPUレベルを表示
        this.ui.cpuALevel.textContent = cpuALevel;
        this.ui.cpuBLevel.textContent = cpuBLevel;

        this.currentRound = 0;
        this.resourceDeck = []; // 資源カードの山札

        this.log('ゲーム開始。');
        this.log(`CPU A: ${cpuALevel}, CPU B: ${cpuBLevel}`);

        // モーダルを非表示
        this.modal.style.display = 'none';

        // 最初のラウンドを開始
        this.nextRound();
    }

    // 次のラウンドへ
    nextRound() {
        this.currentRound++;
        if (this.currentRound > 5) {
            this.endGame();
            return;
        }

        this.log(`--- Round ${this.currentRound} 開始 ---`);
        this.currentMiniRound = 0;

        // 全プレイヤーのラウンドデータをリセット
        Object.values(this.players).forEach(p => p.resetRound());

        // 山札の準備
        this.createDeck();
        
        // UI更新
        this.ui.round.textContent = this.currentRound;
        this.updatePlayerStatsUI(); // プレイヤーのVPやカード状況を更新

        // 最初のミニラウンドを開始
        this.nextMiniRound();
    }

    // 山札の作成（赤20, 青20）とシャッフル
    createDeck() {
        this.resourceDeck = [];
        for (let i = 0; i < 20; i++) {
            this.resourceDeck.push(CARD_TYPES.RED);
            this.resourceDeck.push(CARD_TYPES.BLUE);
        }
        // シャッフル (Fisher-Yates)
        for (let i = this.resourceDeck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.resourceDeck[i], this.resourceDeck[j]] = [this.resourceDeck[j], this.resourceDeck[i]];
        }
    }

    // 次のミニラウンドへ
    nextMiniRound() {
        this.currentMiniRound++;
        if (this.currentMiniRound > 5) {
            this.endRound(); // 5ミニラウンド終了でラウンド集計へ
            return;
        }

        this.log(`** Mini-Round ${this.currentMiniRound} **`);
        this.ui.miniRound.textContent = this.currentMiniRound;

        // 市場の準備 (4枚)
        this.marketCards = [];
        for (let i = 0; i < 4; i++) {
            if (this.resourceDeck.length > 0) {
                this.marketCards.push(this.resourceDeck.pop());
            }
        }
        
        if (this.marketCards.length === 0 && this.resourceDeck.length > 0) {
             this.log("市場のカードがなくなりましたが、山札には残っています。");
        } else if (this.marketCards.length === 0 && this.resourceDeck.length === 0 && this.currentMiniRound <= 5) {
             this.log("山札も市場も空です。ラウンドを強制終了します。");
             this.endRound();
             return;
        }
        
        this.log(`市場: ${this.marketCards.join(', ')}`);

        // UIの更新 (チップ選択待ち)
        this.gameState = GAME_STATE.WAITING_FOR_CHIP;
        this.updateUI();
        this.log('あなたのチップを選択してください...');
    }
    
    // --- チップ選択フェーズ (プレイヤーの操作) ---
    playerSelectChip(chip) {
        if (this.gameState !== GAME_STATE.WAITING_FOR_CHIP) return;
        this.gameState = GAME_STATE.PROCESSING; // 処理中に変更

        // 1. プレイヤーのチップを決定
        const chipIndex = this.player.chips.findIndex(c => c === chip);
        if (chipIndex === -1) { // 多重クリック防止
             this.gameState = GAME_STATE.WAITING_FOR_CHIP;
             return;
        }
        this.player.playedChip = this.player.chips.splice(chipIndex, 1)[0];
        this.log(`あなた: ${this.player.playedChip.name} を選択`);

        // UI（チップボタン）を非アクティブ化
        this.updateUI(); 

        // 2. CPUのチップ思考 (0.5秒遅延)
        setTimeout(() => {
            const gameState = this.getGameStateSnapshot(); // CPU思考用に現状を渡す
            this.cpuA.thinkChip(this.marketCards, gameState);
            this.cpuB.thinkChip(this.marketCards, gameState);

            this.log(`CPU A: チップを選択 (非公開)`);
            this.log(`CPU B: チップを選択 (非公開)`);
            
            // 3. 優先順位決定フェーズへ (1秒遅延)
            setTimeout(() => {
                this.runPriorityPhase();
            }, 1000);
        }, 500);
    }
    
    // --- 優先順位決定フェーズ ---
    runPriorityPhase() {
        this.log(`チップ公開！`);
        this.log(`あなた: <b>${this.player.playedChip.name}</b>`);
        this.log(`CPU A: <b>${this.cpuA.playedChip.name}</b>`);
        this.log(`CPU B: <b>${this.cpuB.playedChip.name}</b>`);

        // UIに公開されたチップを表示
        this.updateUI(true); // true = チップ公開

        // 順位決定ロジック
        const plays = [
            { id: PLAYER_IDS.YOU, chip: this.player.playedChip },
            { id: PLAYER_IDS.CPU_A, chip: this.cpuA.playedChip },
            { id: PLAYER_IDS.CPU_B, chip: this.cpuB.playedChip }
        ];

        // 1. カブりを検出
        const chipCounts = {};
        plays.forEach(p => {
            chipCounts[p.chip.name] = (chipCounts[p.chip.name] || 0) + 1;
        });
        
        // 2. カブったプレイヤーを「最下位」扱い (value = 0)
        const rankedPlays = plays.map(p => ({
            id: p.id,
            value: (chipCounts[p.chip.name] > 1) ? 0 : p.chip.value // カブったら価値0
        }));
        
        // 3. 価値(value)でソート (降順)
        rankedPlays.sort((a, b) => b.value - a.value);

        // 4. ターン順 (this.turnOrder) を決定
        this.turnOrder = rankedPlays; 

        // ログ出力
        this.log('--- 優先順位 ---');
        let rank = 1;
        let logMsg = "";
        for (let i = 0; i < this.turnOrder.length; i++) {
            const p = this.turnOrder[i];
            
            // 同順位（カブり）の処理
            if (i > 0 && p.value === this.turnOrder[i-1].value) {
                logMsg += ` / ${p.id} (タイ)`;
            } else {
                rank = i + 1;
                if (i > 0) this.log(logMsg); // 前の順位のログを確定
                logMsg = `${rank}位: ${p.id}`;
            }
        }
        this.log(logMsg); // 最後のログを確定
        
        // 5. カード獲得フェーズへ (2秒遅延)
        setTimeout(() => {
            this.runCardSelectionPhase();
        }, 2000);
    }
    
    // --- カード獲得フェーズ ---
    async runCardSelectionPhase() {
        this.log('--- カード獲得 ---');
        
        let availableCards = [...this.marketCards];
        
        // 優先順位 (this.turnOrder) に従って処理
        for (let i = 0; i < this.turnOrder.length; i++) {
            const playerInfo = this.turnOrder[i];
            const player = this.players[playerInfo.id];
            
            // 1. この順位で獲得すべき枚数を決定
            let numToTake = 0;
            let currentRank = i;
            
            // 前のプレイヤーと価値が同じ（＝同順位）かチェック
            if (i > 0 && playerInfo.value === this.turnOrder[i-1].value) {
                this.log(`${player.id}は同順位カブりのため、スキップ。`);
                continue; 
            }
            
            // 順位（1位、2位、3位）の決定
            if (i === 0) numToTake = 2; // 1位
            else if (i === 1) numToTake = 1; // 2位
            else if (i === 2) numToTake = 1; // 3位
            
            // 2. 同順位（カブり）の処理
            const clashPlayers = this.turnOrder.filter(p => p.value === playerInfo.value);
            
            if (clashPlayers.length > 1) {
                // カブり発生
                this.log(`<b>カブり発生: ${clashPlayers.map(p=>p.id).join(' / ')}</b>`);
                
                let cardsToClash = [...availableCards]; // カブり対象は常に市場の残り全部

                await this.handleClash(clashPlayers.map(p => p.id), cardsToClash);
                availableCards = []; // カブり処理で全カードが消費された

            } else {
                // 3. 通常処理 (カブりなし)
                if (availableCards.length === 0) {
                    this.log(`${player.id}の番ですが、市場にカードがありません。`);
                    continue;
                }

                // 獲得枚数を市場の残り枚数で制限
                numToTake = Math.min(numToTake, availableCards.length);
                
                if (player.id === PLAYER_IDS.YOU) {
                    // あなたの番
                    this.log(`あなたの番です。市場から ${numToTake} 枚選んでください。`);
                    this.gameState = GAME_STATE.WAITING_FOR_CARD;
                    this.updateMarketUI(availableCards); // クリック可能に
                    
                    const chosenCards = await this.waitForPlayerCardSelection(numToTake, availableCards);
                    this.giveCardsToPlayer(player.id, chosenCards);
                    
                    // 市場から削除
                    chosenCards.forEach(card => {
                        const index = availableCards.findIndex(c => c === card);
                        if(index > -1) availableCards.splice(index, 1);
                    });

                } else {
                    // CPUの番
                    this.log(`${player.id} (CPU) が ${numToTake} 枚選びます...`);
                    // (重要) thinkCardは availableCards を変更しないようにコピーを渡す
                    const chosenCards = player.thinkCard([...availableCards], numToTake);
                    this.giveCardsToPlayer(player.id, chosenCards);
                    
                    // 市場から削除
                    chosenCards.forEach(card => {
                        const index = availableCards.findIndex(c => c === card);
                        if(index > -1) availableCards.splice(index, 1);
                    });
                    
                    await this.sleep(1000); // 1秒待つ
                }
            }
        } // ターン順ループ終了

        this.log('ミニラウンド終了。');
        
        // 残ったカードは捨て札 (UI上は単に消える)
        this.marketCards = []; 
        
        // プレイヤー統計UIを更新
        this.updatePlayerStatsUI();
        this.gameState = GAME_STATE.PROCESSING;
        this.updateUI(); // UIをリセット

        // 3秒後に次のミニラウンドへ
        setTimeout(() => {
            this.nextMiniRound();
        }, 2000);
    }

    // カブり処理 (ルール準拠)
    async handleClash(playerIds, cardsToClash) {
        this.log(`カブり対象カード: [${cardsToClash.join(', ')}]`);
        if (cardsToClash.length === 0) {
            this.log('カブりましたが、対象カードがないため処理を終了します。');
            return;
        }

        // カードをシャッフル
        for (let i = cardsToClash.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cardsToClash[i], cardsToClash[j]] = [cardsToClash[j], cardsToClash[i]];
        }
        
        // 該当プレイヤーに1枚ずつ配る
        for (const id of playerIds) {
            if (cardsToClash.length > 0) {
                const card = cardsToClash.pop();
                this.giveCardsToPlayer(id, [card]);
            }
        }
        // 残りは捨て札 (何もしない)
    }

    // プレイヤーのカード選択を待つ
    waitForPlayerCardSelection(numToTake, availableCards) {
        return new Promise(resolve => {
            let selectedCards = [];
            
            // 市場のカードDOM要素
            const cardElements = this.marketContainer.querySelectorAll('.card');
            // availableCards と DOM をマッピング (DOMの並びとavailableCardsの並びが一致している前提)
            let clickableElements = [];
            
            availableCards.forEach((cardType, index) => {
                const cardEl = cardElements[index];
                if (!cardEl) return;
                
                const clickHandler = (e) => {
                    if (cardEl.classList.contains('selected')) return; // 既に選択済み

                    cardEl.classList.add('selected'); // 視覚的に選択
                    selectedCards.push(cardType);
                    
                    // 他のクリックイベントを一時的に無効化 (多重クリック防止)
                    clickableElements.forEach(el => el.el.style.pointerEvents = 'none');

                    if (selectedCards.length === numToTake) {
                        // 規定枚数に達した
                        clickableElements.forEach(el => {
                            el.el.style.pointerEvents = 'none';
                            el.el.style.opacity = '0.5';
                        });
                        this.gameState = GAME_STATE.PROCESSING;
                        resolve(selectedCards); // 選択したカードを返す
                    } else {
                        // まだ選べる -> クリックイベントを戻す
                         clickableElements.forEach(el => {
                            if (!el.el.classList.contains('selected')) {
                                el.el.style.pointerEvents = 'auto';
                            }
                         });
                    }
                };
                
                cardEl.onclick = clickHandler;
                clickableElements.push({el: cardEl, type: cardType});
            });
        });
    }

    // プレイヤーにカードを渡す
    giveCardsToPlayer(playerId, cards) {
        const player = this.players[playerId];
        cards.forEach(card => {
            if (card === CARD_TYPES.RED) player.cards.red++;
            if (card === CARD_TYPES.BLUE) player.cards.blue++;
        });
        this.log(`${playerId} が [${cards.join(', ')}] を獲得。`);
    }

    // --- ラウンド終了処理 (新ルール) ---
    async endRound() {
        // ラウンドが既に終了処理中の場合、多重実行を防ぐ
        if (this.gameState === GAME_STATE.ROUND_END) return; 
        
        this.log(`--- Round ${this.currentRound} 終了 ---`);
        this.gameState = GAME_STATE.ROUND_END;
        
        // 最終的な統計を更新
        this.updatePlayerStatsUI();

        // ステップ1: 「基本ポイント」の算出
        const scores = [];
        Object.values(this.players).forEach(p => {
            const diff = p.getAbsoluteCardDifference();
            let basicPoints = 0;
            if (diff === 0) basicPoints = 10;
            else if (diff === 1) basicPoints = 8;
            else if (diff === 2) basicPoints = 6;
            else if (diff === 3) basicPoints = 4;
            else if (diff === 4) basicPoints = 2;
            else basicPoints = 0;
            
            scores.push({ id: p.id, basicPoints: basicPoints });
            this.log(`${p.id}: 差額 ${diff} -> 基本 ${basicPoints}点`);
        });

        // ステップ2: 順位判定 (基本ポイントで降順ソート)
        scores.sort((a, b) => b.basicPoints - a.basicPoints);
        
        const p1 = scores[0]; // 1位
        const p2 = scores[1]; // 2位
        const p3 = scores[2]; // 3位
        
        let roundVPs = { [PLAYER_IDS.YOU]: 0, [PLAYER_IDS.CPU_A]: 0, [PLAYER_IDS.CPU_B]: 0 };

        await this.sleep(1000);

        // 条件1：サドンデス発生 ( A=B > C )
        if (p1.basicPoints > 0 && p1.basicPoints === p2.basicPoints && p1.basicPoints > p3.basicPoints) {
            this.log(`<b>条件1: サドンデス発生！</b> (${p1.id} vs ${p2.id})`);
            
            const sd = new SuddenDeath(this, p1.id, p2.id, p3.id);
            const sdResult = await sd.run(); // サドンデスの実行

            // サドンデスの結果を処理
            // 勝者: 基本ポイント + サドンデスポイント
            roundVPs[sdResult.winner] = p1.basicPoints + sdResult.winnerSDPoints;
            // 敗者: 基本ポイント
            roundVPs[sdResult.loser] = p1.basicPoints;
            // 3位: 0点 (没収)
            roundVPs[p3.id] = 0;
            
            this.log(`<b>${sdResult.winner}</b>: ${p1.basicPoints} (基本) + ${sdResult.winnerSDPoints} (SD) = ${roundVPs[sdResult.winner]} VP 獲得！`);
            this.log(`<b>${sdResult.loser}</b>: ${p1.basicPoints} (基本) = ${roundVPs[sdResult.loser]} VP 獲得。`);
            this.log(`<b>${p3.id}</b>: 0 VP (没収)`);

        }
        // 条件2：順位が明確 ( A > B > C )
        else if (p1.basicPoints > p2.basicPoints && p2.basicPoints > p3.basicPoints) {
            this.log(`<b>条件2: 順位が明確。</b> 3位ボーナス発生！`);
            // 3位のC： 基本ポイントを獲得
            roundVPs[p3.id] = p3.basicPoints;
            // 1位(A)と2位(B)： 0点 (没収)
            roundVPs[p1.id] = 0;
            roundVPs[p2.id] = 0;
            
            this.log(`<b>${p3.id}</b> (3位): ${p3.basicPoints} VP 獲得！`);
            this.log(`<b>${p1.id}</b> (1位): 0 VP (没収)`);
            this.log(`<b>${p2.id}</b> (2位): 0 VP (没収)`);
        }
        // 条件3：上記以外 ( A=B=C または A > B=C )
        else {
            this.log(`<b>条件3: 該当者なし。</b> (全員同点、または2位タイ)`);
            // 全員 勝利点 0点
            this.log('全員 0 VP (没収)');
        }
        
        // 最終勝利点 (VP) を加算
        Object.keys(roundVPs).forEach(id => {
            this.players[id].vp += roundVPs[id];
        });
        
        // 勝利点UIを即時反映
        this.updatePlayerStatsUI();

        // 5秒待って次のラウンドへ
        this.log('5秒後に次のラウンドへ進みます...');
        await this.sleep(5000); 
        this.nextRound();
    }

    // ゲーム終了処理
    endGame() {
        this.log('--- ゲーム終了 ---');
        this.gameState = GAME_STATE.GAME_END;
        
        // 最終勝利点の集計
        const finalScores = Object.values(this.players).map(p => ({
            id: p.id,
            vp: p.vp
        }));
        
        finalScores.sort((a, b) => b.vp - a.vp);

        this.log('--- 最終結果 ---');
        let rank = 1;
        for (let i = 0; i < finalScores.length; i++) {
            const p = finalScores[i];
            if (i > 0 && p.vp === finalScores[i-1].vp) {
                 this.log(`同 ${rank}位: <b>${p.id}</b> (${p.vp} VP)`);
            } else {
                 rank = i + 1;
                 this.log(`${rank}位: <b>${p.id}</b> (${p.vp} VP)`);
            }
        }
        
        this.log(`<b>勝者: ${finalScores[0].id}</b>`);
    }

    // --- UI更新関連 ---

    // UI更新（全般）
    updateUI(showPlayedChips = false) {
        // 1. プレイヤーのチップボタン
        this.ui.playerChips.innerHTML = ''; // クリア
        if (this.gameState === GAME_STATE.WAITING_FOR_CHIP) {
            // チップ選択待ち
            this.player.chips.forEach(chip => {
                const btn = document.createElement('button');
                btn.className = `chip-button ${chip.css}`;
                btn.textContent = chip.name;
                btn.onclick = () => this.playerSelectChip(chip);
                this.ui.playerChips.appendChild(btn);
            });
        } else {
            // 処理中 (使用済みチップ + 残りチップ)
            if (this.player.playedChip && showPlayedChips) {
                const chipEl = this.createChipDisplay(this.player.playedChip);
                chipEl.style.opacity = '1.0'; // プレイしたチップは濃く
                this.ui.playerChips.appendChild(chipEl);
            }
            this.player.chips.forEach(chip => {
                const chipEl = this.createChipDisplay(chip, true); // true = 灰色
                this.ui.playerChips.appendChild(chipEl);
            });
        }

        // 2. CPUのチップ
        this.updateCPUChipsUI(this.cpuA, this.ui.cpuAChips, showPlayedChips);
        this.updateCPUChipsUI(this.cpuB, this.ui.cpuBChips, showPlayedChips);
        
        // 3. 市場のカード
        if (this.gameState !== GAME_STATE.WAITING_FOR_CARD) {
             this.updateMarketUI(this.marketCards, null); // null = クリック不可
        }

        // 4. プレイヤーの統計 (カード枚数など)
        this.updatePlayerStatsUI();
    }

    // CPUのチップUI更新
    updateCPUChipsUI(cpu, container, showPlayed) {
        container.innerHTML = '';
        if (showPlayed && cpu.playedChip) {
            // 公開フェーズ
            const chipEl = this.createChipDisplay(cpu.playedChip);
            chipEl.style.opacity = '1.0';
            container.appendChild(chipEl);
        } else if (this.gameState !== GAME_STATE.WAITING_FOR_CHIP && this.player.playedChip) {
            // プレイヤーが選択済みだが、まだ公開前
            const chipEl = this.createChipDisplay(null, true, '?'); // 裏面表示
            chipEl.style.opacity = '1.0';
            container.appendChild(chipEl);
        }
        // 残りチップ
        cpu.chips.forEach(chip => {
            const chipEl = this.createChipDisplay(null, true, '?'); // 裏面表示
            container.appendChild(chipEl);
        });
    }

    // チップ表示用エレメント作成
    createChipDisplay(chip, isDisabled = false, text = null) {
        const el = document.createElement('div');
        el.className = 'chip-display';
        if (chip) {
            el.classList.add(chip.css);
            el.textContent = chip.name;
        } else {
            el.textContent = text || '?';
        }
        if (isDisabled) {
            el.style.opacity = '0.4';
            el.style.backgroundColor = '#555';
        }
        return el;
    }

    // 市場のカードUI更新
    updateMarketUI(cards, clickHandler = null) {
        this.marketContainer.innerHTML = '';
        cards.forEach(cardType => {
            const cardEl = document.createElement('div');
            cardEl.className = `card ${cardType}`;
            cardEl.textContent = cardType === 'red' ? 'R' : 'B';
            
            if (clickHandler) {
                // (注) 実際のクリックハンドラ設定は waitForPlayerCardSelection で行う
                cardEl.style.cursor = 'pointer';
            } else {
                cardEl.style.cursor = 'default';
            }
            this.marketContainer.appendChild(cardEl);
        });
    }

    // 全プレイヤーの統計（カード枚数、VP）UIを更新
    updatePlayerStatsUI() {
        // VP
        this.ui.playerVP.textContent = this.player.vp;
        this.ui.cpuAVP.textContent = this.cpuA.vp;
        this.ui.cpuBVP.textContent = this.cpuB.vp;

        // あなた
        this.ui.playerRed.textContent = this.player.cards.red;
        this.ui.playerBlue.textContent = this.player.cards.blue;
        this.ui.playerDiff.textContent = this.player.getAbsoluteCardDifference();
        // CPU A
        this.ui.cpuARed.textContent = this.cpuA.cards.red;
        this.ui.cpuABlue.textContent = this.cpuA.cards.blue;
        this.ui.cpuADiff.textContent = this.cpuA.getAbsoluteCardDifference();
        // CPU B
        this.ui.cpuBRed.textContent = this.cpuB.cards.red;
        this.ui.cpuBBlue.textContent = this.cpuB.cards.blue;
        this.ui.cpuBDiff.textContent = this.cpuB.getAbsoluteCardDifference();
    }


    // --- ユーティリティ ---

    // CPU思考用に、他プレイヤーの情報を隠したゲーム状態を渡す
    getGameStateSnapshot() {
        // (ハードモード用に他プレイヤーのチップ情報を渡す)
        return {
            players: {
                [PLAYER_IDS.YOU]: { chips: [...this.player.chips] },
                [PLAYER_IDS.CPU_A]: { chips: [...this.cpuA.chips] },
                [PLAYER_IDS.CPU_B]: { chips: [...this.cpuB.chips] }
            },
            marketCards: [...this.marketCards],
            currentMiniRound: this.currentMiniRound
        };
    }

    // ログ出力
    log(message) {
        // console.log(message.replace(/<b>|<\/b>/g, '')); // コンソールにも出す
        const p = document.createElement('p');
        p.innerHTML = message; // (innerHTMLで <b> などを使えるように)
        this.logEl.appendChild(p);
        this.logEl.scrollTop = this.logEl.scrollHeight; // 自動スクロール
    }
    
    // sleep関数
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// --- ゲームの起動 ---
document.addEventListener('DOMContentLoaded', () => {
    const game = new EquilibriumMarketGame();
});