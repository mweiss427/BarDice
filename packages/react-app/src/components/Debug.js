// components/Debug.js

import React from 'react';
import { Contract } from './';
import { useContractLoader } from 'eth-hooks';

const Debug = ({ localProvider, userSigner, address, blockExplorer, contractConfig, localChainId }) => {
  // Load in your local 📝 contract and read a value from it:
  const readContracts = useContractLoader(localProvider, contractConfig);

  // If you want to make 🔐 write transactions to your contracts, use the userSigner:
  const writeContracts = useContractLoader(userSigner, contractConfig, localChainId);

  return (
    <Contract
      name="TheBar"
      signer={userSigner}
      provider={localProvider}
      address={address}
      blockExplorer={blockExplorer}
      contractConfig={contractConfig}
    />
  );
};

export default Debug;
