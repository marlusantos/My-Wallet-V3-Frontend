angular
  .module('walletApp')
  .component('shiftCreate', {
    bindings: {
      fees: '<',
      asset: '<',
      wallet: '<',
      onComplete: '&',
      handleRate: '&',
      handleQuote: '&',
      buildPayment: '&',
      handleApproximateQuote: '&'
    },
    templateUrl: 'templates/shapeshift/create.pug',
    controller: ShiftCreateController,
    controllerAs: '$ctrl'
  });

function ShiftCreateController (Env, AngularHelper, $translate, $scope, $q, currency, Wallet, MyWalletHelpers, $uibModal, Exchange, Ethereum, ShapeShift, buyStatus, MyWallet) {
  let UPPER_LIMIT;
  Env.then(env => UPPER_LIMIT = env.shapeshift.upperLimit || 500);

  this.trading = ShapeShift.trading;

  this.from = this.wallet || Wallet.getDefaultAccount();
  this.to = this.wallet ? Wallet.getDefaultAccount() : Ethereum.defaultAccount;

  this.origins = this.wallet ? [this.wallet] : [this.from, this.to];
  this.destinations = this.wallet ? [Wallet.getDefaultAccount(), Ethereum.defaultAccount] : [this.to];

  $scope.toEther = currency.convertToEther;
  $scope.toSatoshi = currency.convertToSatoshi;
  $scope.fromSatoshi = currency.convertFromSatoshi;
  $scope.toBitcoinCash = currency.convertToBitcoinCash;
  $scope.fromBitcoinCash = currency.convertFromBitcoinCash;
  $scope.country = MyWallet.wallet.accountInfo.countryCodeGuess;
  $scope.fiat = $scope.country === 'US'
    ? currency.currencies.filter(c => c.code === 'USD')[0]
    : currency.currencies.filter(c => c.code === 'EUR')[0];
  $scope.ether = currency.ethCurrencies.filter(c => c.code === 'ETH')[0];
  $scope.bitcoin = currency.bitCurrencies.filter(c => c.code === 'BTC')[0];
  $scope.bitcoinCash = currency.bchCurrencies.filter(c => c.code === 'BCH')[0];
  $scope.dollars = Wallet.settings.displayCurrency;
  $scope.forms = $scope.state = {};

  buyStatus.canBuy().then((res) => $scope.canBuy = res);

  let state = $scope.state = {
    baseCurr: this.asset || 'btc',
    rate: { min: null, max: null },
    input: { amount: null, curr: this.asset || 'btc' },
    output: { amount: null, curr: this.asset ? 'btc' : 'eth' },
    get baseInput () { return this.baseCurr === state.input.curr; },
    get baseBTC () { return this.baseCurr === 'btc'; },
    get baseBCH () { return this.baseCurr === 'bch'; }
  };

  $scope.getQuoteArgs = (state) => ({
    pair: state.input.curr + '_' + state.output.curr,
    amount: state.baseInput ? state.input.amount : -state.output.amount
  });

  $scope.refreshQuote = MyWalletHelpers.asyncOnce(() => {
    let fetchSuccess = (quote) => {
      $scope.quote = quote; state.error = null; state.loadFailed = false;
      if (state.baseInput) state.output.amount = Number.parseFloat(quote.withdrawalAmount);
      else state.input.amount = Number.parseFloat(quote.depositAmount);
      AngularHelper.$safeApply();
    };

    this.handleApproximateQuote($scope.getQuoteArgs(state))
      .then(fetchSuccess, () => { state.loadFailed = true; });
  }, 500, () => {
    $scope.quote = null;
  });

  $scope.refreshIfValid = (field) => {
    if ($scope.state[field].amount) {
      $scope.quote = null;
      state.loadFailed = false;
      $scope.refreshQuote();
    }
  };

  $scope.getSendAmount = () => {
    $scope.lock();
    state.baseCurr = state.input.curr;
    this.handleQuote($scope.getQuoteArgs(state)).then((quote) => {
      let payment = this.buildPayment({quote: quote, fee: $scope.cachedFee, from: this.from});
      payment.getFee().then((fee) => this.onComplete({payment: payment, fee: fee, quote: quote}));
    }).then($scope.free);
  };

  $scope.setTo = () => {
    let output = state.output;
    state.baseCurr = state.output.curr;
    state.output = state.input; state.input = output;
    this.to = this.origins.find((o) => o.label !== this.from.label);
  };

  let getRate = () => {
    let upperLimit = !state.baseBTC && !state.baseBCH
                     ? parseFloat(currency.formatCurrencyForView($scope.toEther(UPPER_LIMIT, $scope.fiat), $scope.ether, false))
                     : state.baseBTC ? $scope.fromSatoshi($scope.toSatoshi(UPPER_LIMIT, $scope.fiat), $scope.bitcoin)
                                     : $scope.fromBitcoinCash($scope.toBitcoinCash(UPPER_LIMIT, $scope.fiat), $scope.bitcoinCash);

    return $q.resolve(this.handleRate({rate: state.input.curr + '_' + state.output.curr}))
      .then((rate) => { state.rate.min = rate.minimum; state.rate.max = rate.maxLimit < upperLimit ? rate.maxLimit : upperLimit; });
  };

  $scope.getAvailableBalance = () => {
    let fetchSuccess = (balance, fee) => {
      $scope.maxAvailable = state.baseBTC || state.baseBCH ? $scope.fromSatoshi(balance.amount, $scope.bitcoin) : parseFloat(currency.formatCurrencyForView(balance.amount, $scope.ether, false));
      $scope.cachedFee = balance.fee;

      state.error = null;
      state.balanceFailed = false;
      if (this.wallet) {
        state.input.amount = Math.min(state.rate.max, $scope.maxAvailable);
      }
    };

    let fetchError = (err) => {
      $scope.maxAvailable = 0;
      state.balanceFailed = true;
      if (Exchange.interpretError(err) === 'No free outputs to spend') {
        state.error = $translate.instant('.NO_FUNDS_TO_EXCHANGE');
      } else {
        state.error = Exchange.interpretError(err);
      }
    };

    let fee = this.fees[state.baseCurr];
    return $q.resolve(this.from.getAvailableBalance(fee)).then(fetchSuccess, fetchError);
  };

  if (!this.trading().isDisabled) {
    $scope.$watch('state.input.curr', () => getRate().then($scope.getAvailableBalance));
    $scope.$watch('state.output.curr', () => getRate().then($scope.getAvailableBalance));
    $scope.$watch('$ctrl.from.balance', (n, o) => n !== o && $scope.getAvailableBalance());
    $scope.$watch('state.output.curr', () => state.baseInput && $scope.refreshIfValid('input'));
    $scope.$watch('state.input.amount', () => state.baseInput && $scope.refreshIfValid('input'));
    $scope.$watch('state.output.amount', () => !state.baseInput && $scope.refreshIfValid('output'));
  }

  this.currencyHelper = (obj) => {
    if (obj.wei) {
      return {
        name: 'eth',
        icon: 'icon-ethereum'
      };
    } else if (obj.keyRing) {
      return {
        name: 'btc',
        icon: 'icon-bitcoin'
      };
    } else {
      return {
        name: 'bch',
        icon: 'icon-bitcoin-cash'
      };
    }
  };

  // Stat: how often do users see the "max limit" error?
  let sawMaxLimit = false;
  Wallet.api.incrementShapeshiftStat();
  $scope.$watch('forms.shiftForm.input.$error.max && maxAvailable >= state.rate.max', (errorShown) => {
    if (errorShown && !sawMaxLimit) {
      sawMaxLimit = true;
      Wallet.api.incrementShapeshiftStat({ maxLimitError: true });
    }
  });

  AngularHelper.installLock.call($scope);
}
