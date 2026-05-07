package com.qbft.besu.service;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.web3j.crypto.Credentials;
import org.web3j.protocol.Web3j;
import org.web3j.protocol.core.methods.response.TransactionReceipt;
import org.web3j.tx.RawTransactionManager;
import org.web3j.tx.TransactionManager;
import org.web3j.tx.gas.ContractGasProvider;
import org.web3j.tx.gas.DefaultGasProvider;
import org.web3j.tx.gas.StaticGasProvider;

import java.math.BigInteger;

@Service
@RequiredArgsConstructor
public class TokenService {

    private final Web3j web3j;
    private final ContractAddressStore contractAddressStore;

    // Sender - pre-funded dev account (gets all initial token supply)
    Credentials deployer = Credentials.create(
            "8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63"
    );

    // Receiver - another dev account
    Credentials receiver = Credentials.create(
            "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789fedcba"
    );

    // Gas provider - zero gas for our private QBFT network
    private final ContractGasProvider gasProvider = new StaticGasProvider(BigInteger.ZERO,
            new BigInteger("1fffffffffffff", 16));

    // Store deployed contract address in memory
    private String contractAddress;

    @PostConstruct
    public void init() {
        contractAddressStore.load().ifPresent(address -> {
            contractAddress = address;
            System.out.println("Loaded existing contract at: " + contractAddress);
        });
    }

    // ─── Deploy ───────────────────────────────────────────────

    private TransactionManager getTxManager() {
        return new RawTransactionManager(
                web3j,
                deployer,
                1337L
        );
    }

    public String deployToken() throws Exception {
        MyToken token = MyToken.deploy(
                web3j,
                getTxManager(),
                gasProvider,
                BigInteger.valueOf(1_000_000)  // 1,000,000 MTK initial supply
        ).send();

        contractAddress = token.getContractAddress();
        contractAddressStore.save(contractAddress);
        return "Contract deployed at: " + contractAddress;
    }

    public String redeployToken() throws Exception {
        contractAddress = null;
        contractAddressStore.clear();
        return deployToken();
    }

    public String getContractAddress() {
        return contractAddress != null ? contractAddress : "Not deployed yet";
    }

    // ─── Read ─────────────────────────────────────────────────

    public String getTokenName() throws Exception {
        MyToken token = loadContract();
        return token.name().send();
    }

    public String getTotalSupply() throws Exception {
        MyToken token = loadContract();
        return token.totalSupply().send().toString();
    }

    public String getBalance(String address) throws Exception {
        MyToken token = loadContract();
        return token.balanceOf(address).send().toString();
    }

    // ─── Write ────────────────────────────────────────────────

    public String transfer(String toAddress, long amount) throws Exception {
        MyToken token = loadContract();
        TransactionReceipt receipt = token.transfer(
                toAddress,
                BigInteger.valueOf(amount)
        ).send();
        return "Tx hash: " + receipt.getTransactionHash();
    }

    public String approve(String spenderAddress, long amount) throws Exception {
        MyToken token = loadContract();
        TransactionReceipt receipt = token.approve(
                spenderAddress,
                BigInteger.valueOf(amount)
        ).send();
        return "Approved. Tx hash: " + receipt.getTransactionHash();
    }

    // ─── Helper ───────────────────────────────────────────────

    private MyToken loadContract() {
        if (contractAddress == null) {
            throw new IllegalStateException("Contract not deployed yet. Call /token/deploy first.");
        }
        return MyToken.load(contractAddress, web3j, getTxManager(), gasProvider);
    }
}
