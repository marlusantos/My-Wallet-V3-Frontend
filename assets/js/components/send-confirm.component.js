angular
  .module('walletApp')
  .component('sendConfirm', {
    bindings: {
      tx: '<',
      asset: '<',
      onSend: '&',
      onGoBack: '&'
    },
    templateUrl: 'partials/send/send-confirm.pug',
    controller: SendConfirmController
  });

function SendConfirmController (Wallet, currency) {
  this.getTransactionTotal = (includeFee) => {
    let tx = this.tx;
    let fee = includeFee ? tx.fee : 0;
    return tx.amount + fee;
  };

  this.canGoBack = () => this.asset !== 'BCH';

  this.getButtonContent = () => {
    if (this.asset === 'BCH') return 'SEND_BITCOIN_CASH';
    if (this.asset === 'ETH') return 'SEND_ETHER';
    if (this.asset === 'BTC') this.tx.destination.type !== 'External' ? 'TRANSFER_BITCOIN' : 'SEND_BITCOIN';
  };

  console.log('send confirm', this);
}
