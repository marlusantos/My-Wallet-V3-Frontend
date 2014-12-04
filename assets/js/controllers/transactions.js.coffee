@TransactionsCtrl = ($scope, Wallet, MyWallet, $log, $stateParams, $timeout) ->
    
  #################################
  #           Private             #
  #################################
    
  $scope.didLoad = () ->
    $scope.transactions = Wallet.transactions      
    $scope.addressBook = Wallet.addressBook
    $scope.status    = Wallet.status
    $scope.settings = Wallet.settings
    $scope.totals = Wallet.totals  
    $scope.accountIndex = $stateParams.accountIndex
        
    # Check if MyWallet is a mock or the real thing. The mock will simulate an 
    # incoming transaction after 3 seconds. 
    if MyWallet.mockShouldReceiveNewTransaction != undefined && $stateParams.accountIndex == "1"
      return if $scope.transactions.length == 0
      for transaction  in $scope.transactions
        if transaction.note == "Thanks for the tea"
          return

      $timeout((->
        MyWallet.mockShouldReceiveNewTransaction()
        ), 3000)
        
  $scope.transactionFilter = (item) ->
    return true if $stateParams.accountIndex == ""
    return (!item.to_account? || item.to_account == -1) && (!item.from_account? || item.from_account == -1) if  $stateParams.accountIndex == "imported"
    return item.to_account == parseInt($stateParams.accountIndex) || item.from_account == parseInt($stateParams.accountIndex)
  
  # First load:      
  $scope.didLoad()
  
