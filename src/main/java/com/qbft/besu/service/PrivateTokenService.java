package com.qbft.besu.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.web3j.abi.FunctionEncoder;
import org.web3j.abi.datatypes.generated.Uint256;
import org.web3j.crypto.Credentials;
import org.web3j.protocol.Web3j;
import org.web3j.protocol.besu.Besu;
import org.web3j.protocol.besu.response.privacy.PrivateTransactionReceipt;
import org.web3j.protocol.core.DefaultBlockParameter;
import org.web3j.protocol.core.DefaultBlockParameterName;
import org.web3j.protocol.core.methods.response.EthGetCode;
import org.web3j.protocol.core.methods.response.EthGetTransactionReceipt;
import org.web3j.protocol.core.methods.response.EthSendTransaction;
import org.web3j.protocol.core.methods.response.TransactionReceipt;
import org.web3j.tx.BesuPrivateTransactionManager;
import org.web3j.tx.PrivateTransactionManager;
import org.web3j.tx.TransactionManager;
import org.web3j.tx.gas.ContractGasProvider;
import org.web3j.tx.gas.StaticGasProvider;
import org.web3j.tx.response.PollingTransactionReceiptProcessor;
import org.web3j.tx.response.TransactionReceiptProcessor;
import org.web3j.utils.Base64String;
import org.web3j.utils.Restriction;

import java.io.IOException;
import java.math.BigInteger;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@SuppressWarnings("deprecation")
public class PrivateTokenService {

    private final Besu besu;

    Credentials deployer = Credentials.create(
            "8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63"
    );

    public static final String TESSERA1_PUB = "r5jdUQunVuomY6J29bV2Ra3nNcfi8WbF1hoL4auh8g0=";
    public static final String TESSERA2_PUB = "N0zqYDSJ7Turpwl+ZHjVEPBCofbYCP/RExeioiOGkRA=";
    public static final String TESSERA3_PUB = "Z2VrezAPO3q2WvDO8BhxE8248hOiXOIDedLRItAGdG0=";
    public static final String TESSERA4_PUB = "+wYsWvhicjotWKeyRiO1hfoVj+aVaN9QQDcf709cpA8=";

    private final ContractGasProvider gasProvider = new StaticGasProvider(
            BigInteger.ZERO,
            new BigInteger("1fffffffffffff", 16)
    );

    private String privateContractAddress;
    private static final String PRIVACY_GROUP_ID = "pFz8bdP2NjNcR8nF9A54DklndUlbYUgt1xJvHCQJq3g=";

    // ─── Private Transaction Manager ──────────────────────────

    private PrivateTransactionManager getTxManager() {
        Base64String privateFrom = Base64String.wrap(TESSERA1_PUB);
        Base64String privacyGroupId = Base64String.wrap(PRIVACY_GROUP_ID);

        TransactionReceiptProcessor receiptProcessor = new PollingTransactionReceiptProcessor(
                besu, 1000, 30
        );

        return new PrivateTransactionManager(
                besu,
                deployer,
                receiptProcessor,
                1337L,
                privateFrom,
                privacyGroupId,      // use actual Besu privacy group ID
                Restriction.RESTRICTED
        );
    }

    // ─── Deploy Private Contract ───────────────────────────────

    public String deployPrivateToken() throws Exception {
        if (privateContractAddress != null) {
            return "Private contract already deployed at: " + privateContractAddress;
        }

        String encodedConstructor = FunctionEncoder.encodeConstructor(
                Arrays.asList(new Uint256(BigInteger.valueOf(1_000_000)))
        );

        PrivateTransactionManager txManager = getTxManager();

        BigInteger privNonce = besu.privGetTransactionCount(
                deployer.getAddress(),
                Base64String.wrap(PRIVACY_GROUP_ID)
        ).send().getTransactionCount();

        BigInteger ethNonce = besu.ethGetTransactionCount(
                deployer.getAddress(),
                DefaultBlockParameterName.LATEST
        ).send().getTransactionCount();

        System.out.println("Priv nonce: " + privNonce);
        System.out.println("Eth nonce: " + ethNonce);

        EthSendTransaction response = txManager.sendTransaction(
                BigInteger.ZERO,                        // gas price
                new BigInteger("1fffffffffffff", 16),   // gas limit
                null,                                   // to = null means deploy
                MyToken.BINARY + encodedConstructor,    // bytecode + constructor
                BigInteger.ZERO,                        // value
                true                                    // constructor = true
        );

        System.out.println("Tx hash: " + response.getTransactionHash());
        if (response.hasError()) {
            System.out.println("Error code: " + response.getError().getCode());
            System.out.println("Error message: " + response.getError().getMessage());
            System.out.println("Error data: " + response.getError().getData());
            return "Error: " + response.getError().getCode()
                    + " - " + response.getError().getMessage()
                    + " - " + response.getError().getData();
        }

        if (response.hasError()) {
            return "Error: " + response.getError().getCode()
                    + " - " + response.getError().getMessage();
        }

        String txHash = response.getTransactionHash();
        Thread.sleep(4000);

        PrivateTransactionReceipt privReceipt = besu
                .privGetTransactionReceipt(txHash)
                .send()
                .getResult();

        if (privReceipt != null && privReceipt.getContractAddress() != null) {
            privateContractAddress = privReceipt.getContractAddress();
            return "Private contract deployed at: " + privateContractAddress;
        }

        return "Deployed tx: " + txHash + " (receipt pending)";
    }

    // ─── Private Transfer ──────────────────────────────────────

    public String privateTransfer(String toAddress, long amount) throws Exception {
        if (privateContractAddress == null) {
            throw new IllegalStateException("Private contract not deployed yet.");
        }

        MyToken token = MyToken.load(
                privateContractAddress,
                besu,
                getTxManager(),
                gasProvider
        );

        TransactionReceipt receipt = token.transfer(
                toAddress,
                BigInteger.valueOf(amount)
        ).send();

        return "Private tx hash: " + receipt.getTransactionHash();
    }

    // ─── Private Balance ───────────────────────────────────────

    public String privateBalance(String address) throws Exception {
        if (privateContractAddress == null) {
            throw new IllegalStateException("Private contract not deployed yet.");
        }

        MyToken token = MyToken.load(
                privateContractAddress,
                besu,
                getTxManager(),
                gasProvider
        );

        return token.balanceOf(address).send().toString();
    }
}
