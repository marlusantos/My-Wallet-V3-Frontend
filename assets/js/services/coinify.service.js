angular
  .module('walletApp')
  .factory('coinify', coinify);

function coinify (Env, BrowserHelper, $timeout, $q, $state, $uibModal, $uibModalStack, Wallet, MyWallet, MyWalletHelpers, Alerts, currency, MyWalletBuySell, BlockchainConstants, modals, MyBlockchainApi, Exchange) {
  const ONE_DAY_MS = 86400000;

  let states = {
    error: ['expired', 'rejected', 'cancelled'],
    success: ['completed', 'completed_test'],
    pending: ['awaiting_transfer_in', 'reviewing', 'processing', 'pending', 'updateRequested'],
    completed: ['expired', 'rejected', 'cancelled', 'completed', 'completed_test']
  };

  let txHashes = {};

  const service = {
    get exchange () {
      return MyWallet.wallet.external.coinify;
    },
    get limits () {
      return service.exchange.profile.limits;
    },
    get trades () {
      return service.exchange.trades;
    },
    get kycs () {
      return service.exchange.kycs.sort((a, b) => a.createdAt < b.createdAt);
    },
    get userCanTrade () {
      return !service.disabledForFork && (!service.exchange.user || service.exchange.profile.canTrade);
    },
    get balanceAboveMin () {
      return service.sellMax && service.sellMax > service.limits.blockchain.minimumInAmounts['BTC'];
    },
    get balanceAboveMax () {
      return service.sellMax && service.sellMax > service.limits.blockchain.inRemaining['BTC'];
    },
    get userCanBuy () {
      return service.userCanTrade;
    },
    get userCanSell () {
      return service.userCanTrade && service.balanceAboveMin;
    },
    get buyReason () {
      let reason;
      let { profile, user } = service.exchange;

      if (service.disabledForFork) reason = 'disabled_for_fork';
      else if (user && !profile.canTrade) reason = profile.cannotTradeReason;
      else if (!user) reason = 'user_needs_account';
      else reason = 'has_remaining_buy_limit';

      return reason;
    },
    get sellReason () {
      let reason;
      let { profile, user } = service.exchange;

      if (service.disabledForFork) reason = 'disabled_for_fork';
      else if (user && !profile.canTrade) reason = profile.cannotTradeReason;
      else if (service.balanceAboveMin) reason = 'can_sell_remaining_balance';
      else if (!service.balanceAboveMin) reason = 'not_enough_funds_to_sell';
      else if (service.balanceAboveMax) reason = 'can_sell_max';
      else reason = 'can_sell_max';

      return reason;
    },
    get buyLaunchOptions () {
      let reason = service.buyReason;
      let { user, profile } = service.exchange;

      if (reason === 'disabled_for_fork') return { 'LEARN_MORE': modals.openBtcForkInfo };
      else if (reason === 'has_remaining_buy_limit' && user && +profile.level.name < 2) return { 'KYC': service.openPendingKYC };
      else if (reason === 'awaiting_first_trade_completion' && service.getPendingTrade()) return { 'FINISH': service.openPendingTrade, 'CANCEL': service.cancelTrade };
      else if (reason === 'awaiting_first_trade_completion' && service.getProcessingTrade()) return { 'CHECK_STATUS': service.openProcessingTrade };
      else if (reason === 'after_first_trade') return { 'WHY': service.openTradingDisabledHelper };
    },
    get sellLaunchOptions () {
      let reason = service.sellReason;
      let { user, profile } = service.exchange;

      if (reason === 'disabled_for_fork') return { 'LEARN_MORE': modals.openBtcForkInfo };
      else if (reason === 'can_sell_max' && user && profile.level && +profile.level.name < 2) return { 'KYC': service.openPendingKYC };
      else if (reason === 'not_enough_funds_to_sell') return { 'REQUEST': modals.openRequest, 'BUY': service.goToBuy };
      else if (reason === 'awaiting_first_trade_completion' && service.getPendingTrade()) return { 'FINISH': service.openPendingTrade, 'CANCEL': service.cancelTrade };
      else if (reason === 'awaiting_first_trade_completion' && service.getProcessingTrade()) return { 'CHECK_STATUS': service.openProcessingTrade };
      else if (reason === 'after_first_trade') return { 'WHY': service.openTradingDisabledHelper };
    },
    states,
    getTxMethod: (hash) => txHashes[hash] || null,
    tradeStateIn: (states) => (t) => states.indexOf(t.state) > -1,
    goToBuy: () => $state.go('wallet.common.buy-sell.coinify', {selectedTab: 'BUY_BITCOIN'}),
    setSellMax: (balance) => { service.sellMax = balance.amount / 1e8; service.sellFee = balance.fee; }
  };

  service.init = (coinify) => {
    return Env.then(env => {
      coinify.api.sandbox = !env.isProduction;
      coinify.partnerId = env.partners.coinify.partnerId;
      service.disabledForFork = env.disabledForFork;
      if (coinify.trades) Exchange.watchTrades(coinify.trades);
      coinify.monitorPayments();
    });
  };

  service.buying = () => {
    return {
      reason: service.buyReason,
      isDisabled: !service.userCanBuy,
      launchOptions: service.buyLaunchOptions
    };
  };

  service.selling = () => {
    return {
      reason: service.sellReason,
      isDisabled: !service.userCanSell,
      launchOptions: service.sellLaunchOptions
    };
  };

  service.getQuote = (amt, curr, quoteCurr) => {
    if (curr === 'BTC') amt = -amt;
    return $q.resolve(service.exchange.getBuyQuote(Math.trunc(amt), curr, quoteCurr));
  };

  service.getSellQuote = (amt, curr, quoteCurr) => {
    if (curr === 'BTC') amt = -amt;
    return $q.resolve(service.exchange.getSellQuote(Math.trunc(amt), curr, quoteCurr));
  };

  service.cancelTrade = (trade) => {
    let msg = 'CONFIRM_CANCEL_TRADE';
    if (!trade) trade = service.getPendingTrade();
    if (trade.medium === 'bank') msg = 'CONFIRM_CANCEL_BANK_TRADE';

    return Alerts.confirm(msg, {
      action: 'CANCEL_TRADE',
      cancel: 'GO_BACK'
    }).then(() => trade.cancel().then(() => Exchange.fetchExchangeData(service.exchange)), () => {})
      .catch((e) => { Alerts.displayError('ERROR_TRADE_CANCEL'); });
  };

  service.getPendingKYC = () => {
    return service.kycs[0] && service.tradeStateIn(service.states.pending)(service.kycs[0]) && service.kycs[0];
  };

  service.getRejectedKYC = () => {
    return service.kycs[0] && service.tradeStateIn(service.states.error)(service.kycs[0]) && service.kycs[0];
  };

  service.getOpenKYC = () => {
    return service.kycs.length && service.getPendingKYC() ? service.getPendingKYC() : service.exchange.triggerKYC();
  };

  service.openPendingKYC = () => {
    modals.openBuyView(null, service.getOpenKYC());
  };

  service.getPendingTrade = () => {
    let trades = service.exchange.trades;
    return trades.filter((trade) => trade._state === 'awaiting_transfer_in')[0];
  };

  service.getProcessingTrade = () => {
    let trades = service.exchange.trades;
    return trades.filter((trade) => trade._state === 'processing')[0];
  };

  service.openPendingTrade = () => {
    modals.openBuyView(null, service.getPendingTrade());
  };

  service.openProcessingTrade = () => {
    modals.openBuyView(null, service.getProcessingTrade());
  };

  service.openTradingDisabledHelper = () => {
    let canTradeAfter = service.exchange.profile.canTradeAfter;
    let days = isNaN(canTradeAfter) ? 1 : Math.ceil((canTradeAfter - Date.now()) / ONE_DAY_MS);

    modals.openHelper('coinify_after-trade', { days: days });
  };

  service.pollUserLevel = () => {
    let kyc = service.getPendingKYC();
    let success = () => { Exchange.fetchProfile(service.exchange); Alerts.displaySuccess('KYC_APPROVED'); };

    kyc && Exchange.pollUserLevel(() => kyc && kyc.refresh(), () => kyc.state === 'completed', success);
  };

  service.signupForAccess = (email, country, state) => {
    BrowserHelper.safeWindowOpen('https://docs.google.com/forms/d/e/1FAIpQLSeYiTe7YsqEIvaQ-P1NScFLCSPlxRh24zv06FFpNcxY_Hs0Ow/viewform?entry.1192956638=' + email + '&entry.644018680=' + country + '&entry.387129390=' + state);
  };

  service.incrementBuyDropoff = (step) => {
    MyBlockchainApi.incrementBuyDropoff(step);
  };

  return service;
}
